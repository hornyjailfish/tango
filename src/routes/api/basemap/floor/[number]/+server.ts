import { json, error } from '@sveltejs/kit';
import { getFloorData } from '#lib/server/basemap.js';
import type { RequestHandler } from './$types';

/** Cached floor (SVG + graph + joins) — always served from Surreal, never live Tango. */
export const GET: RequestHandler = async ({ params }) => {
	const number = Number(params.number);
	if (Number.isNaN(number)) throw error(400, 'floor number must be a number');
	const floor = await getFloorData(number);
	if (!floor) throw error(404, `floor ${number} not in cache`);
	return json(floor);
};