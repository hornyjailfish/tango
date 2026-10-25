/**
 * Live Tango API client. Only the sync job touches this at runtime —
 * the UI always reads the Surreal cache (plan.md §Sync flow step 7).
 */
export const TANGO_BASE = 'https://api.tango.vision';
export const DEFAULT_MALL_ID = '6804d32a394e07fd48a1447c';

export function mallId(): string {
	return typeof process !== 'undefined'
		? (process.env.PUBLIC_MALL_ID ?? process.env.MALL_ID ?? DEFAULT_MALL_ID)
		: DEFAULT_MALL_ID;
}

export interface RawPayload<T> {
	payload: T;
	etag: string | null;
}

async function getJson<T>(path: string): Promise<RawPayload<T>> {
	const res = await fetch(`${TANGO_BASE}${path}`, {
		headers: { accept: 'application/json' },
		signal: AbortSignal.timeout(30_000)
	});
	if (!res.ok) throw new Error(`Tango ${path} → HTTP ${res.status}`);
	return {
		payload: (await res.json()) as T,
		etag: res.headers.get('etag')
	};
}

export const fetchMall = () => getJson<unknown>(`/mall/${mallId()}`);
export const fetchMap = () => getJson<unknown>(`/mall/${mallId()}/map`);
export const fetchShops = () => getJson<unknown>(`/shop?mall=${mallId()}`);
export const fetchCategories = () => getJson<unknown>(`/category?mall=${mallId()}`);