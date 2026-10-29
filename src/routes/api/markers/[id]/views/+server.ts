import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addView, getMarker, listViews } from '#lib/server/markers.js';

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const GET: RequestHandler = async ({ params }) => {
	const id = params.id;
	if (!id) error(400, 'Missing marker id');
	const marker = await getMarker(id);
	if (!marker) error(404, 'Marker not found');
	return json(await listViews(id));
};

export const POST: RequestHandler = async ({ params, request }) => {
	const id = params.id;
	if (!id) error(400, 'Missing marker id');
	const marker = await getMarker(id);
	if (!marker) error(404, 'Marker not found');

	const ct = request.headers.get('content-type') ?? '';
	if (!ct.includes('multipart/form-data')) {
		error(400, 'Expected multipart form upload with field "image"');
	}

	const form = await request.formData();
	const file = form.get('image');
	if (!file || !(file instanceof File)) {
		error(400, 'Missing image file field');
	}
	if (!ALLOWED.has(file.type)) {
		error(400, `Unsupported type ${file.type || '(empty)'} — use jpeg/png/webp/gif`);
	}
	if (file.size <= 0 || file.size > MAX_BYTES) {
		error(400, `Image must be 1 byte … ${MAX_BYTES} bytes`);
	}

	const buf = Buffer.from(await file.arrayBuffer());
	const view = await addView({
		markerId: id,
		bytes: buf,
		contentType: file.type,
		ext: file.name.split('.').pop()?.toLowerCase()
	});
	return json(view, { status: 201 });
};
