import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readImage } from '#lib/server/markers.js';

export const GET: RequestHandler = async ({ params }) => {
	const key = params.key;
	if (!key) error(400, 'Missing key');
	const file = await readImage(key);
	if (!file) error(404, 'Image not found');
	return new Response(new Uint8Array(file.bytes), {
		headers: {
			'content-type': file.contentType,
			'cache-control': 'public, max-age=31536000, immutable'
		}
	});
};
