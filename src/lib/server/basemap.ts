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

/**
 * UI entry point: reads the Surreal cache only.
 * First run with zero cache blocks on one sync (plan.md: "only block first-run with zero cache").
 */
export async function getBasemapMeta(): Promise<BasemapMeta> {
	let revision = await getRevision();
	if (revision.lastError?.fingerprint === 'no-cache') {
		const outcome = await syncBasemap();
		revision = outcome.revision;
	}
	const [mall, floors, shops, categories] = await Promise.all([
		getMall(),
		getFloors(),
		getShops(),
		getCategories()
	]);
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