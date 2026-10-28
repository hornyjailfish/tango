import { json } from '@sveltejs/kit';
import { syncBasemap } from '#lib/server/sync.js';
import type { RequestHandler } from './$types';

/** Manual / cron trigger for the Tango → Surreal sync job. */
export const POST: RequestHandler = async () => {
	const outcome = await syncBasemap();
	return Response.json(outcome);
};

