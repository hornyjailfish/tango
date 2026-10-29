import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { bytesToDataUrl, vprSearch } from '#lib/server/embedding.js';

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const POST: RequestHandler = async ({ request }) => {
	const ct = request.headers.get('content-type') ?? '';
	if (!ct.includes('multipart/form-data')) {
		error(400, 'Expected multipart/form-data with an image field');
	}

	const form = await request.formData();
	const file = form.get('image');
	if (!(file instanceof File)) {
		error(400, 'Missing image file');
	}
	if (file.size <= 0 || file.size > MAX_BYTES) {
		error(400, 'Image must be between 1 byte and 12MB');
	}

	const mime = (file.type || 'image/jpeg').toLowerCase();
	if (mime && !ALLOWED.has(mime) && !mime.startsWith('image/')) {
		error(400, `Unsupported image type: ${mime}`);
	}

	const topKRaw = form.get('top_k') ?? form.get('topK');
	const minScoreRaw = form.get('min_score') ?? form.get('minScore');
	const floorRaw = form.get('floor');
	const targetRaw = form.get('target');

	const topK = topKRaw != null ? Number(topKRaw) : 8;
	// Default 0: return full top-k diversity; callers/UI filter by score locally if needed.
	const minScore = minScoreRaw != null ? Number(minScoreRaw) : 0;
	const floor =
		floorRaw != null && String(floorRaw).trim() !== '' ? Number(floorRaw) : null;
	const target = typeof targetRaw === 'string' && targetRaw.trim() ? targetRaw.trim() : 'markers';

	const buf = new Uint8Array(await file.arrayBuffer());
	const imageUrl = bytesToDataUrl(buf, mime || 'image/jpeg');

	try {
		const result = await vprSearch({
			imageUrl,
			target,
			topK: Number.isFinite(topK) ? Math.min(Math.max(1, Math.floor(topK)), 30) : 8,
			minScore: Number.isFinite(minScore) ? minScore : 0,
			floor: floor != null && Number.isFinite(floor) ? floor : null
		});
		return json(result);
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'VPR search failed';
		error(502, msg);
	}
};
