import { query } from '$app/server';
import { z } from 'zod';
import { query as surrealQuery } from '#lib/server/db.js';
import { recordKey } from '#lib/server/surreal-id.js';

const searchInput = z.object({
	q: z.string().trim().min(1).max(120),
	limit: z.number().int().min(1).max(30).optional()
});

export type ShopSearchHit = {
	id: string;
	name: string;
	floor: number | null;
	categories: string[];
	searchTags: string | null;
	roomNumber: string | null;
	logo: string | null;
	color: string | null;
	description: string | null;
	shortDescription: string | null;
	/** Combined rank: name BM25 heavily weighted over tags. */
	score: number;
	nameScore: number;
	tagScore: number;
};

type RawHit = {
	id: unknown;
	name?: unknown;
	floor?: unknown;
	categories?: unknown;
	searchTags?: unknown;
	roomNumber?: unknown;
	logo?: unknown;
	color?: unknown;
	description?: unknown;
	shortDescription?: unknown;
	nameScore?: unknown;
	tagScore?: unknown;
};

function asString(v: unknown): string | null {
	if (v == null) return null;
	if (typeof v === 'string') return v;
	return String(v);
}

function asNumber(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '') {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

function asStringArray(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v.filter((x): x is string => typeof x === 'string');
}

/** Name matches dominate; tags are a tie-break / fallback. */
function rankScore(nameScore: number, tagScore: number): number {
	return nameScore * 1000 + tagScore;
}

function normalizeHit(row: RawHit): ShopSearchHit | null {
	const id = recordKey(row.id, 'shop_cache');
	if (!id) return null;
	const nameScore = asNumber(row.nameScore) ?? 0;
	const tagScore = asNumber(row.tagScore) ?? 0;
	return {
		id,
		name: asString(row.name) ?? id,
		floor: asNumber(row.floor),
		categories: asStringArray(row.categories),
		searchTags: asString(row.searchTags),
		roomNumber: asString(row.roomNumber),
		logo: asString(row.logo),
		color: asString(row.color),
		description: asString(row.description),
		shortDescription: asString(row.shortDescription),
		nameScore,
		tagScore,
		score: rankScore(nameScore, tagScore)
	};
}

/**
 * BM25 shop search: name index first, tags second.
 * Empty/null tags never break the match — name-only shops still rank.
 */
export const searchShops = query(searchInput, async ({ q, limit = 12 }): Promise<ShopSearchHit[]> => {
	// Fetch a wider candidate set so name hits aren't pushed out by tag floods,
	// then re-sort with name-weighted score and trim.
	const fetchLimit = Math.min(Math.max(limit * 4, 40), 80);

	const rows = await surrealQuery<RawHit[]>(
		`SELECT
			id,
			name,
			floor,
			categories,
			searchTags,
			roomNumber,
			logo,
			color,
			description,
			shortDescription,
			search::score(1) AS nameScore,
			search::score(2) AS tagScore
		FROM shop_cache
		WHERE (searchName @1@ $q OR searchTagsText @2@ $q)
			AND isActive = true
		ORDER BY nameScore DESC, tagScore DESC
		LIMIT $fetchLimit;`,
		{ q, fetchLimit }
	);

	const list = Array.isArray(rows[0]) ? rows[0] : [];
	const hits: ShopSearchHit[] = [];
	for (const row of list) {
		const hit = normalizeHit(row);
		if (hit) hits.push(hit);
	}

	hits.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		// Prefer earlier name substring when scores tie
		const qLower = q.toLocaleLowerCase();
		const aName = a.name.toLocaleLowerCase();
		const bName = b.name.toLocaleLowerCase();
		const aStarts = aName.startsWith(qLower) ? 1 : 0;
		const bStarts = bName.startsWith(qLower) ? 1 : 0;
		if (bStarts !== aStarts) return bStarts - aStarts;
		const aHas = aName.includes(qLower) ? 1 : 0;
		const bHas = bName.includes(qLower) ? 1 : 0;
		if (bHas !== aHas) return bHas - aHas;
		return a.name.localeCompare(b.name, 'ru');
	});

	return hits.slice(0, limit);
});
