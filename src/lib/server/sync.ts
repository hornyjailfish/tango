import { createHash } from 'node:crypto';
import {
	ADAPTER_CURRENT,
	fetchMap,
	fetchShops,
	fetchMall,
	fetchCategories,
	parseMap,
	parseShops,
	parseMall,
	parseCategories
} from '#lib/tango/index.js';
import {
	getRevision,
	saveRevision,
	upsertFloors,
	upsertShops,
	upsertCategories,
	upsertMall,
	type BasemapRevision
} from './cache';

export interface SyncOutcome {
	revision: BasemapRevision;
	changed: boolean;
	source: 'tango' | 'cache' | 'unchanged';
}

let running: Promise<SyncOutcome> | null = null;

/**
 * Sync flow (plan.md §Sync flow):
 * fetch → Zod safeParse with current adapter → invariants →
 *   6a. success: upsert cache, syncStatus=ok, clear lastError
 *   6b. failure: do NOT overwrite last-good basemap, syncStatus=error + lastError
 * UI always reads Surreal, never live Tango.
 */
export function syncBasemap(): Promise<SyncOutcome> {
	if (!running) {
		running = runSync().finally(() => {
			running = null;
		});
	}
	return running;
}

async function runSync(): Promise<SyncOutcome> {
	const prev = await getRevision();

	let mallRaw, mapRaw, shopsRaw, catsRaw;
	try {
		mallRaw = await fetchMall();
	} catch (err) {
		return fail(prev, 'mall', err);
	}

	// Cheap short-circuit: nothing changed since last good sync.
	if (
		prev.syncStatus === 'ok' &&
		prev.mallVersion !== null &&
		(mallRaw.payload as { mallVersion?: number }).mallVersion === prev.mallVersion
	) {
		return { revision: prev, changed: false, source: 'unchanged' };
	}

	try {
		[mapRaw, shopsRaw, catsRaw] = await Promise.all([fetchMap(), fetchShops(), fetchCategories()]);
	} catch (err) {
		return fail(prev, 'fetch', err);
	}

	const mall = parseMall(mallRaw.payload);
	if (!mall.ok) return fail(prev, 'mall', mall.error);
	const map = parseMap(mapRaw.payload);
	if (!map.ok) return fail(prev, 'map', map.error);
	const shops = parseShops(shopsRaw.payload);
	if (!shops.ok) return fail(prev, 'shop', shops.error);
	const cats = parseCategories(catsRaw.payload);
	if (!cats.ok) return fail(prev, 'category', cats.error);

	const contentHash = createHash('sha256')
		.update(JSON.stringify(map.data.floors))
		.digest('hex');

	await upsertMall(mall.data);
	await upsertFloors(map.data.floors);
	await upsertShops(shops.data);
	await upsertCategories(cats.data);

	const revision: BasemapRevision = {
		adapterVersion: ADAPTER_CURRENT,
		contentHash,
		mallVersion: mall.data.mallVersion,
		etag: mallRaw.etag,
		fetchedAt: new Date().toISOString(),
		syncStatus: 'ok',
		lastError: null
	};
	await saveRevision(revision);
	return { revision, changed: prev.contentHash !== contentHash, source: 'tango' };
}

async function fail(
	prev: BasemapRevision,
	path: string,
	err: unknown
): Promise<SyncOutcome> {
	const message = err instanceof Error ? err.message : String(err);
	const lastError = 'fingerprint' in (err as object) ? (err as BasemapRevision['lastError']) : null;
	const revision: BasemapRevision = {
		...prev,
		syncStatus: 'error',
		lastError: lastError ?? { path, message, issues: [message], fingerprint: message.slice(0, 500) }
	};
	// last-good basemap is intentionally NOT touched
	await saveRevision({ syncStatus: 'error', lastError: revision.lastError });
	return { revision, changed: false, source: 'cache' };
}