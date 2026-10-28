import { z } from 'zod';

export const MALL_ADAPTER_VERSION = 'tango-mall-v1';

export const categorySchema = z.looseObject({
	_id: z.string().min(1),
	facade: z.record(z.string(), z.looseObject({ name: z.string().nullish() }))
});

export const categoryListSchema = z.array(categorySchema);
export type CategoryV1 = z.infer<typeof categorySchema>;

export const mallThemeSchema = z.looseObject({
	color1: z.string().nullish(),
	color2: z.string().nullish(),
	color3: z.string().nullish(),
	color4: z.string().nullish(),
	color5: z.string().nullish(),
	color6: z.string().nullish(),
	color7: z.string().nullish(),
	color8: z.string().nullish(),
	color9: z.string().nullish(),
	color10: z.string().nullish(),
	my_location_marker: z.string().nullish(),
	map_object_highlight: z.string().nullish(),
	map_portal_button: z.string().nullish(),
	map_path_arrow: z.string().nullish()
});

export const mallSchema = z.looseObject({
	_id: z.string().min(1),
	name: z.string().nullish(),
	mallVersion: z.number().nullish(),
	settings: z.unknown().optional(),
	theme: mallThemeSchema.nullish(),
	logotype: z.string().nullish()
});

export type MallV1 = z.infer<typeof mallSchema>;

/** Tango mall.theme → app tokens. */
export interface MallTheme {
	/** Brand primary (color1 / color8) */
	primary: string;
	/** Deep brand (color6) */
	primaryDeep: string;
	/** Ink / text (color2) */
	ink: string;
	/** On-primary text (color3) */
	onPrimary: string;
	/** Soft surface (color4) */
	surface: string;
	/** Border / muted line (color5) */
	border: string;
	/** Page wash (color7) */
	wash: string;
	/** Selected object on map */
	highlight: string;
	/** Walk path / location accents */
	path: string;
	portal: string;
	location: string;
}

export interface NormalizedMall {
	id: string;
	name: string | null;
	mallVersion: number | null;
	defaultFloorNumber: number | null;
	logotype: string | null;
	theme: MallTheme;
}

export interface NormalizedCategory {
	id: string;
	name: string;
}

const DEFAULT_THEME: MallTheme = {
	primary: '#e30a7d',
	primaryDeep: '#731051',
	ink: '#000000',
	onPrimary: '#ffffff',
	surface: '#ebf1f6',
	border: '#c8d2db',
	wash: '#f5f8fc',
	highlight: '#f9c416',
	path: '#0c94d1',
	portal: '#0c94d1',
	location: '#0c94d1'
};

function pickHex(value: string | null | undefined, fallback: string): string {
	if (!value) return fallback;
	const t = value.trim();
	return t.length > 0 ? t : fallback;
}

export function normalizeTheme(
	theme: z.infer<typeof mallThemeSchema> | null | undefined
): MallTheme {
	return {
		primary: pickHex(theme?.color1 ?? theme?.color8, DEFAULT_THEME.primary),
		primaryDeep: pickHex(theme?.color6, DEFAULT_THEME.primaryDeep),
		ink: pickHex(theme?.color2, DEFAULT_THEME.ink),
		onPrimary: pickHex(theme?.color3 ?? theme?.color9, DEFAULT_THEME.onPrimary),
		surface: pickHex(theme?.color4, DEFAULT_THEME.surface),
		border: pickHex(theme?.color5, DEFAULT_THEME.border),
		wash: pickHex(theme?.color7, DEFAULT_THEME.wash),
		highlight: pickHex(theme?.map_object_highlight, DEFAULT_THEME.highlight),
		path: pickHex(theme?.map_path_arrow, DEFAULT_THEME.path),
		portal: pickHex(theme?.map_portal_button, DEFAULT_THEME.portal),
		location: pickHex(theme?.my_location_marker, DEFAULT_THEME.location)
	};
}

export function normalizeMall(mall: MallV1): NormalizedMall {
	const settings = mall.settings as Record<string, unknown> | null | undefined;
	const fromSettings = settings?.defaultFloorNumber ?? settings?.defaultFloor;
	const defaultFloorNumber =
		typeof fromSettings === 'number'
			? fromSettings
			: typeof fromSettings === 'string' &&
				  fromSettings !== '' &&
				  !Number.isNaN(Number(fromSettings))
				? Number(fromSettings)
				: null;
	return {
		id: mall._id,
		name: mall.name ?? null,
		mallVersion: mall.mallVersion ?? null,
		defaultFloorNumber,
		logotype: mall.logotype ?? null,
		theme: normalizeTheme(mall.theme)
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

/** Fill missing theme on older mall_cache rows. */
export function ensureMallTheme(mall: NormalizedMall | null): NormalizedMall | null {
	if (!mall) return null;
	if (mall.theme?.primary && mall.theme?.highlight) return mall;
	return { ...mall, theme: normalizeTheme(mall.theme as never) };
}

/** Apply mall theme as CSS custom properties on an element (usually <html>). */
export function themeToCssVars(theme: MallTheme): Record<string, string> {
	return {
		'--mall-primary': theme.primary,
		'--mall-primary-deep': theme.primaryDeep,
		'--mall-ink': theme.ink,
		'--mall-on-primary': theme.onPrimary,
		'--mall-surface': theme.surface,
		'--mall-border': theme.border,
		'--mall-wash': theme.wash,
		'--mall-highlight': theme.highlight,
		'--mall-path': theme.path,
		'--mall-portal': theme.portal,
		'--mall-location': theme.location,
		// shadcn bridges
		'--primary': theme.primary,
		'--primary-foreground': theme.onPrimary,
		'--ring': theme.primary,
		'--accent': theme.highlight,
		'--accent-foreground': theme.ink,
		'--secondary': theme.surface,
		'--secondary-foreground': theme.ink,
		'--muted': theme.border,
		'--muted-foreground': theme.ink,
		'--border': theme.border,
		'--input': theme.border,
		'--background': theme.wash,
		'--foreground': theme.ink,
		'--card': theme.surface,
		'--card-foreground': theme.ink,
		'--sidebar-primary': theme.primary,
		'--sidebar-primary-foreground': theme.onPrimary
	};
}
