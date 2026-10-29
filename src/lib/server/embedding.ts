/**
 * Client for the VPR embedding FastAPI service (MegaLoc encode / search).
 */
import { recordKey } from './surreal-id.js';

const DEFAULT_PORT = process.env.FASTAPI_PORT ?? '8030';
const BASE = (
	process.env.EMBEDDING_SERVICE_URL ??
	process.env.VPR_SERVICE_URL ??
	`http://127.0.0.1:${DEFAULT_PORT}`
).replace(/\/+$/, '');

export type VprSearchViewHit = {
	id: string;
	score: number;
};

export type VprSearchHit = {
	/** Bare marker key (no `markers:` prefix). */
	id: string;
	/** Cosine peak among views. */
	peak: number;
	/** Aggregated parent score. */
	score: number;
	floor: number | null;
	zoneId: string | null;
	x: number;
	y: number;
	label: string | null;
	views: VprSearchViewHit[];
};

export type VprSearchResponse = {
	target: string;
	topK: number;
	minScore: number;
	count: number;
	results: VprSearchHit[];
};

function asNumber(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '') {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

function asString(v: unknown): string | null {
	if (v == null) return null;
	if (typeof v === 'string') return v;
	// Avoid String(object) → "[object Object]" leaking into UI labels.
	if (typeof v === 'object') return null;
	return String(v);
}

/** Marker label may be a plain string or a small i18n map from upstream. */
function asLabel(v: unknown): string | null {
	if (v == null) return null;
	if (typeof v === 'string') {
		const t = v.trim();
		return t && t !== '[object Object]' ? t : null;
	}
	if (typeof v === 'object') {
		const o = v as Record<string, unknown>;
		for (const k of ['en', 'ru', 'name', 'label', 'text', 'value']) {
			const s = o[k];
			if (typeof s === 'string' && s.trim()) return s.trim();
		}
		return null;
	}
	const s = String(v).trim();
	return s && s !== '[object Object]' ? s : null;
}

/** `basemap_floor:-1` / `basemap_floor:⟨-1⟩` → -1 */
function floorFromLevel(level: unknown): number | null {
	const key = recordKey(level, 'basemap_floor');
	if (!key) return null;
	const n = Number(key);
	return Number.isFinite(n) ? n : null;
}

function normalizeHit(raw: Record<string, unknown>): VprSearchHit | null {
	const id = recordKey(raw.id, 'markers');
	if (!id) return null;

	const geom = raw.geometry;
	let x = 0;
	let y = 0;
	if (geom && typeof geom === 'object') {
		const g = geom as Record<string, unknown>;
		// Service returns GeoJSON-ish { longitude: x, latitude: y } in plan space.
		x = asNumber(g.longitude) ?? asNumber(g.x) ?? 0;
		y = asNumber(g.latitude) ?? asNumber(g.y) ?? 0;
	}

	const viewsRaw = Array.isArray(raw.views) ? raw.views : [];
	const views: VprSearchViewHit[] = [];
	for (const v of viewsRaw) {
		if (!v || typeof v !== 'object') continue;
		const vr = v as Record<string, unknown>;
		const vid = recordKey(vr.id, 'marker_views');
		const score = asNumber(vr.score);
		if (!vid || score == null) continue;
		views.push({ id: vid, score });
	}

	const zoneRaw = asString(raw.zone);
	const zoneId =
		zoneRaw && zoneRaw.length > 0 ? recordKey(zoneRaw, 'zones') || zoneRaw : null;

	return {
		id,
		peak: asNumber(raw.peak) ?? 0,
		score: asNumber(raw.score) ?? 0,
		floor: floorFromLevel(raw.level),
		zoneId,
		x,
		y,
		label: asLabel(raw.label),
		views
	};
}

export async function vprSearch(input: {
	/** data: / http(s) / base64 image reference accepted by the service. */
	imageUrl: string;
	target?: string;
	topK?: number;
	minScore?: number;
	/** Optional floor filter (service filter key `level`). */
	floor?: number | null;
}): Promise<VprSearchResponse> {
	const target = input.target ?? 'markers';
	const topK = input.topK ?? 8;
	// Prefer 0 so the service returns a diverse top-k; UI applies score cutoff client-side.
	const minScore = input.minScore ?? 0;
	const body: Record<string, unknown> = {
		target,
		image_url: input.imageUrl,
		top_k: topK,
		min_score: minScore
	};
	if (input.floor !== null && input.floor !== undefined) {
		body.filters = { level: `basemap_floor:${input.floor}` };
	}

	const res = await fetch(`${BASE}/search`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify(body)
	});

	const text = await res.text();
	if (!res.ok) {
		let detail = text.slice(0, 300);
		try {
			const j = JSON.parse(text) as { detail?: unknown };
			if (typeof j.detail === 'string') detail = j.detail;
			else if (j.detail != null) detail = JSON.stringify(j.detail).slice(0, 300);
		} catch {
			// keep raw
		}
		throw new Error(detail || `VPR search failed (${res.status})`);
	}

	const raw = JSON.parse(text) as Record<string, unknown>;
	const list = Array.isArray(raw.results) ? raw.results : [];
	const results: VprSearchHit[] = [];
	for (const item of list) {
		if (!item || typeof item !== 'object') continue;
		const hit = normalizeHit(item as Record<string, unknown>);
		if (hit) results.push(hit);
	}

	return {
		target: asString(raw.target) ?? target,
		topK: asNumber(raw.top_k) ?? topK,
		minScore: asNumber(raw.min_score) ?? minScore,
		count: asNumber(raw.count) ?? results.length,
		results
	};
}

/** Turn uploaded bytes into a data URL the embedding service accepts. */
export function bytesToDataUrl(bytes: Uint8Array, contentType: string): string {
	const mime = contentType && contentType.includes('/') ? contentType : 'image/jpeg';
	const b64 = Buffer.from(bytes).toString('base64');
	return `data:${mime};base64,${b64}`;
}
