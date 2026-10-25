import { getBasemapMeta } from '#lib/server/basemap.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({
	meta: await getBasemapMeta()
});