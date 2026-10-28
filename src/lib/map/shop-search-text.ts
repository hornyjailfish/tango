/**
 * Build BM25 corpora for shop search.
 * Defensive: searchTags may be null/none/empty/array/other if the API drifts.
 *
 * Name and tags are separate so ranking can prefer name hits over tag hits
 * (e.g. "ДЕТСКИЙ МИР" above every shop tagged "детская").
 */

export function normalizeSearchTags(raw: unknown): string {
	if (raw == null) return '';
	if (Array.isArray(raw)) {
		return raw
			.map((t) => (t == null ? '' : String(t).trim()))
			.filter(Boolean)
			.join(' ');
	}
	if (typeof raw === 'string') return raw.trim();
	return String(raw).trim();
}

export function buildShopSearchName(input: {
	name?: string | null;
	roomNumber?: string | null;
}): string {
	return [(input.name ?? '').trim(), (input.roomNumber ?? '').trim()]
		.filter((p) => p.length > 0)
		.join(' ');
}

export function buildShopSearchTagsText(input: { searchTags?: unknown }): string {
	return normalizeSearchTags(input.searchTags);
}

/** Full corpus fields written on shop upsert. */
export function buildShopSearchFields(input: {
	name?: string | null;
	roomNumber?: string | null;
	searchTags?: unknown;
}): { searchName: string; searchTagsText: string; searchText: string } {
	const searchName = buildShopSearchName(input);
	const searchTagsText = buildShopSearchTagsText(input);
	const searchText = [searchName, searchTagsText].filter((p) => p.length > 0).join(' ');
	return { searchName, searchTagsText, searchText };
}

/** @deprecated use buildShopSearchFields — kept for older call sites/tests */
export function buildShopSearchText(input: {
	name?: string | null;
	roomNumber?: string | null;
	searchTags?: unknown;
}): string {
	return buildShopSearchFields(input).searchText;
}
