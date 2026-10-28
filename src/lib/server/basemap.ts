import { syncBasemap } from './sync';
import {
	getCategories,
	getFloor,
	getFloors,
	getMall,
	getRevision,
	getShops,
	type BasemapRevision
} from './cache';
import type {
	NormalizedCategory,
	NormalizedFloor,
	NormalizedMall,
	NormalizedShop
} from '#lib/tango/adapters/index.js';

export interface BasemapMeta {
	revision: BasemapRevision;
	mall: NormalizedMall | null;
	floors: { number: number }[];
	shops: NormalizedShop[];
	categories: NormalizedCategory[];
}

function isEmptyCache(
	revision: BasemapRevision,
	floors: { number: number }[],
	mall: NormalizedMall | null
): boolean {
	if (revision.lastError?.fingerprint === 'no-cache') return true;
	if (revision.contentHash === null && floors.length === 0 && mall === null) return true;
	if (floors.length === 0) return true;
	return false;
}

/**
 * UI entry point: always serves from Surreal.
 * Empty cache → block once on Tango sync; if API is down, return graceful error meta (no throw).
 */
export async function getBasemapMeta(): Promise<BasemapMeta> {
	let revision = await getRevision();
	let [mall, floors, shops, categories] = await Promise.all([
		getMall(),
		getFloors(),
		getShops(),
		getCategories()
	]);

	if (isEmptyCache(revision, floors, mall)) {
		try {
			const outcome = await syncBasemap();
			revision = outcome.revision;
		} catch (err) {
			// transport-level blow-up (DB down mid-write, etc.) — still return a readable error
			const message = err instanceof Error ? err.message : String(err);
			revision = {
				...revision,
				syncStatus: 'error',
				lastError: {
					path: 'sync',
					message,
					issues: [message],
					fingerprint: message.slice(0, 500)
				}
			};
		}
		[mall, floors, shops, categories] = await Promise.all([
			getMall(),
			getFloors(),
			getShops(),
			getCategories()
		]);
	}

	return {
		revision,
		mall,
		floors: floors.map((f) => ({ number: f.number })),
		shops,
		categories
	};
}

export async function getFloorData(number: number): Promise<NormalizedFloor | null> {
	return getFloor(number);
}