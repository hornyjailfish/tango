import type { z } from 'zod';
import { MAP_ADAPTER_VERSION, mapSchema, mapInvariants, normalizeMap } from './map-v1';
import { SHOP_ADAPTER_VERSION, shopListSchema, shopInvariants, normalizeShops } from './shop-v1';
import { MALL_ADAPTER_VERSION, mallSchema, categoryListSchema, normalizeMall, normalizeCategories } from './mall-v1';

/** Runtime pins exactly one current adapter (plan.md §Adapter versions). */
export const ADAPTER_CURRENT = 'tango-map-v1';

export { MAP_ADAPTER_VERSION, SHOP_ADAPTER_VERSION, MALL_ADAPTER_VERSION };
export * from './map-v1';
export * from './shop-v1';
export * from './mall-v1';

export interface ParseFailure {
	ok: false;
	error: {
		path: string;
		message: string;
		issues: string[];
		fingerprint: string;
	};
}

export type ParseResult<T> = { ok: true; data: T } | ParseFailure;

function failure(source: string, err: z.ZodError | string): ParseFailure {
	const issues =
		typeof err === 'string'
			? [err]
			: err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
	return {
		ok: false,
		error: {
			path: source,
			message: issues[0] ?? 'unknown parse error',
			issues: issues.slice(0, 20),
			fingerprint: issues.slice(0, 5).join(' | ').slice(0, 500)
		}
	};
}

export function parseMap(payload: unknown): ParseResult<ReturnType<typeof normalizeMap>> {
	const parsed = mapSchema.safeParse(payload);
	if (!parsed.success) return failure('map', parsed.error);
	const inv = mapInvariants(parsed.data);
	if (inv.length) return failure('map/invariants', inv.join(' | '));
	return { ok: true, data: normalizeMap(parsed.data) };
}

export function parseShops(payload: unknown): ParseResult<ReturnType<typeof normalizeShops>> {
	const parsed = shopListSchema.safeParse(payload);
	if (!parsed.success) return failure('shop', parsed.error);
	const inv = shopInvariants(parsed.data);
	if (inv.length) return failure('shop/invariants', inv.join(' | '));
	return { ok: true, data: normalizeShops(parsed.data) };
}

export function parseMall(payload: unknown): ParseResult<ReturnType<typeof normalizeMall>> {
	const parsed = mallSchema.safeParse(payload);
	if (!parsed.success) return failure('mall', parsed.error);
	return { ok: true, data: normalizeMall(parsed.data) };
}

export function parseCategories(payload: unknown): ParseResult<ReturnType<typeof normalizeCategories>> {
	const parsed = categoryListSchema.safeParse(payload);
	if (!parsed.success) return failure('category', parsed.error);
	return { ok: true, data: normalizeCategories(parsed.data) };
}