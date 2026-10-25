import { z } from 'zod';

export const MALL_ADAPTER_VERSION = 'tango-mall-v1';

export const categorySchema = z.looseObject({
	_id: z.string().min(1),
	facade: z.record(
		z.string(),
		z.looseObject({ name: z.string().nullish() })
	)
});

export const categoryListSchema = z.array(categorySchema);
export type CategoryV1 = z.infer<typeof categorySchema>;

export const mallSchema = z.looseObject({
	_id: z.string().min(1),
	name: z.string().nullish(),
	mallVersion: z.number().nullish(),
	settings: z.unknown().optional()
});

export type MallV1 = z.infer<typeof mallSchema>;

export interface NormalizedMall {
	id: string;
	name: string | null;
	mallVersion: number | null;
	defaultFloorNumber: number | null;
}

export interface NormalizedCategory {
	id: string;
	name: string;
}

export function normalizeMall(mall: MallV1): NormalizedMall {
	const settings = mall.settings as Record<string, unknown> | null | undefined;
	const fromSettings = settings?.defaultFloorNumber ?? settings?.defaultFloor;
	const defaultFloorNumber =
		typeof fromSettings === 'number'
			? fromSettings
			: typeof fromSettings === 'string' && fromSettings !== '' && !Number.isNaN(Number(fromSettings))
				? Number(fromSettings)
				: null;
	return {
		id: mall._id,
		name: mall.name ?? null,
		mallVersion: mall.mallVersion ?? null,
		defaultFloorNumber
	};
}

export function normalizeCategories(categories: CategoryV1[]): NormalizedCategory[] {
	return categories.map((c) => {
		const locales = Object.keys(c.facade ?? {});
		let name: string | null = null;
		for (const locale of ['ru', 'en', ...locales]) {
			const n = c.facade?.[locale]?.name;
			if (n) {
				name = n;
				break;
			}
		}
		return { id: c._id, name: name ?? c._id };
	});
}