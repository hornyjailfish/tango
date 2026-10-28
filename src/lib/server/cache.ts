import { query } from './db';
import { recordKey } from './surreal-id.js';
import {
	ensureMallTheme,
	type NormalizedFloor,
	type NormalizedShop,
	type NormalizedCategory,
	type NormalizedMall
} from '#lib/tango/adapters/index.js';

export type SyncStatus = 'ok' | 'stale' | 'error';

export interface SyncError {
	path: string;
	message: string;
	issues: string[];
	fingerprint: string;
}

export interface BasemapRevision {
	adapterVersion: string;
	contentHash: string | null;
	mallVersion: number | null;
	etag: string | null;
	fetchedAt: string | null;
	syncStatus: SyncStatus;
	lastError: SyncError | null;
}

export const EMPTY_REVISION: BasemapRevision = {
	adapterVersion: 'tango-map-v1',
	contentHash: null,
	mallVersion: null,
	etag: null,
	fetchedAt: null,
	syncStatus: 'error',
	lastError: {
		path: 'cache',
		message: 'No basemap cached yet',
		issues: [],
		fingerprint: 'no-cache'
	}
};

function asList<T>(rows: T[][] | T[]): T[] {
	const first = rows[0];
	return Array.isArray(first) ? (first as T[]) : [];
}

export async function getRevision(): Promise<BasemapRevision> {
	const rows = await query<BasemapRevision[]>('SELECT * FROM basemap_revision:current LIMIT 1');
	const row = rows[0]?.[0];
	return row ? { ...EMPTY_REVISION, ...row } : EMPTY_REVISION;
}

export async function saveRevision(patch: Partial<BasemapRevision>): Promise<void> {
	await query('UPSERT basemap_revision:current MERGE $patch;', { patch });
}

export async function upsertFloors(floors: NormalizedFloor[]): Promise<void> {
	await query(
		'FOR $f IN encoding::json::decode($json) { UPSERT type::record("basemap_floor", $f.number) CONTENT $f; };',
		{ json: JSON.stringify(floors) }
	);
}

export async function getFloors(): Promise<NormalizedFloor[]> {
	const rows = await query<NormalizedFloor[]>(
		'SELECT number FROM basemap_floor ORDER BY number ASC'
	);
	return asList(rows);
}

export async function getFloor(number: number): Promise<NormalizedFloor | null> {
	const rows = await query<NormalizedFloor[]>(
		'SELECT * FROM type::record("basemap_floor", $number) LIMIT 1',
		{ number }
	);
	return rows[0]?.[0] ?? null;
}

export async function upsertShops(shops: NormalizedShop[]): Promise<void> {
	// JSON string + decode: RPC bind would turn searchTags like "re:STORE,…" into RecordIds.
	await query(
		'FOR $s IN encoding::json::decode($json) { UPSERT type::record("shop_cache", $s.id) CONTENT $s; };',
		{ json: JSON.stringify(shops) }
	);
}

export async function getShops(): Promise<NormalizedShop[]> {
	const rows = await query<NormalizedShop[]>('SELECT * FROM shop_cache');
	return asList(rows).map((raw) => ({
		...raw,
		id: recordKey(raw.id, 'shop_cache'),
		name: raw.name ?? '',
		searchTags: raw.searchTags ?? null,
		categories: raw.categories ?? [],
		isActive: raw.isActive ?? true
	}));
}

export async function upsertCategories(categories: NormalizedCategory[]): Promise<void> {
	await query(
		'FOR $c IN encoding::json::decode($json) { UPSERT type::record("category_cache", $c.id) CONTENT $c; };',
		{ json: JSON.stringify(categories) }
	);
}

export async function getCategories(): Promise<NormalizedCategory[]> {
	const rows = await query<NormalizedCategory[]>('SELECT * FROM category_cache');
	return asList(rows).map((c) => ({
		...c,
		id: recordKey(c.id, 'category_cache'),
		name: c.name ?? recordKey(c.id, 'category_cache')
	}));
}

export async function upsertMall(mall: NormalizedMall): Promise<void> {
	await query(
		'LET $m = encoding::json::decode($json); UPSERT type::record("mall_cache", $m.id) CONTENT $m;',
		{ json: JSON.stringify(mall) }
	);
}

export async function getMall(): Promise<NormalizedMall | null> {
	const rows = await query<NormalizedMall[]>('SELECT * FROM mall_cache LIMIT 1');
	const raw = rows[0]?.[0] ?? null;
	if (!raw) return null;
	return ensureMallTheme({
		...raw,
		id: recordKey(raw.id, 'mall_cache')
	});
}
