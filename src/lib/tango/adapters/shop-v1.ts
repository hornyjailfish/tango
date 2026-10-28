import { z } from 'zod';
import { DateTime } from 'surrealdb';

export const SHOP_ADAPTER_VERSION = 'tango-shop-v1';

const facadeLocaleSchema = z.looseObject({
	name: z.string().nullish(),
	description: z.string().nullish(),
	shortDescription: z.string().nullish()
});

export const shopSchema = z.looseObject({
	_id: z.string().min(1),
	facade: z.record(z.string(), facadeLocaleSchema),
	categories: z.array(z.string()).nullish(),
	floor: z.number().nullish(),
	logo: z.string().nullish(),
	color: z.string().nullish(),
	searchTags: z.string().nullish(),
	roomNumber: z.string().nullish(),
	isActive: z.boolean().nullish(),
	updatedAt: z.string().nullish()
	// contacts/social ignored — not needed for internal map tool (looseObject keeps API extras)
});

export const shopListSchema = z.array(shopSchema);

export type ShopV1 = z.infer<typeof shopSchema>;

export interface NormalizedShop {
	id: string;
	name: string;
	description: string | null;
	shortDescription: string | null;
	logo: string | null;
	color: string | null;
	floor: number | null;
	categories: string[];
	searchTags: string | null;
	roomNumber: string | null;
	isActive: boolean;
	updatedAt: DateTime | string | null;
}

function pickFacade(
	shop: ShopV1,
	field: 'name' | 'description' | 'shortDescription'
): string | null {
	const locales = Object.keys(shop.facade ?? {});
	for (const locale of ['ru', 'en', ...locales]) {
		const value = shop.facade?.[locale]?.[field];
		if (value) return value;
	}
	return null;
}

export function normalizeShop(shop: ShopV1): NormalizedShop {
	return {
		id: shop._id,
		name: pickFacade(shop, 'name') ?? shop._id,
		description: pickFacade(shop, 'description'),
		shortDescription: pickFacade(shop, 'shortDescription'),
		logo: shop.logo ?? null,
		color: shop.color ?? null,
		floor: shop.floor ?? null,
		categories: shop.categories ?? [],
		searchTags: shop.searchTags ?? null,
		roomNumber: shop.roomNumber ?? null,
		isActive: shop.isActive ?? true,
		updatedAt: shop.updatedAt ?? null
	};
}

export function normalizeShops(shops: ShopV1[]): NormalizedShop[] {
	return shops.map(normalizeShop);
}

export function shopInvariants(shops: ShopV1[]): string[] {
	const errors: string[] = [];
	if (shops.length === 0) return ['shops: empty payload'];
	for (const shop of shops) {
		if (!shop._id) errors.push('shops: record without _id');
	}
	return errors;
}
