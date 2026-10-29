/**
 * VPR markers + views — Surreal access helpers.
 * Plan coordinates use geometry Point [x, y] in floor SVG space.
 * View images live in bucket `marker_images` (Surreal TYPE file / FileRef via CBOR).
 */
import { randomUUID } from 'node:crypto';
import { FileRef, GeometryPoint } from 'surrealdb';
import { query } from './db.js';
import { recordKey, recordId } from './surreal-id.js';
import type {
	EmbeddingQueueStatus,
	MarkerPoint,
	MarkerRecord,
	MarkerViewRecord
} from '#lib/types/markers.js';

export type { EmbeddingQueueStatus, MarkerPoint, MarkerRecord, MarkerViewRecord };

/** Only bucket this app may read/write. Never ee_map `map` or other shared buckets. */
export const MARKER_IMAGES_BUCKET = 'marker_images';
const BUCKET = MARKER_IMAGES_BUCKET;

type RawRow = Record<string, unknown>;

function asList<T>(rows: T[][] | T[]): T[] {
	const first = rows[0];
	return Array.isArray(first) ? (first as T[]) : [];
}

function asString(v: unknown): string | null {
	if (v == null) return null;
	if (typeof v === 'string') return v;
	return String(v);
}

function asNumber(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '') {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

/** Plan/SVG units — not geodesy. One decimal is plenty for pin placement. */
const PLAN_COORD_DECIMALS = 1;

export function roundPlanCoord(n: number): number {
	const f = 10 ** PLAN_COORD_DECIMALS;
	return Math.round(n * f) / f;
}

function asDatetime(v: unknown): string | null {
	if (v == null) return null;
	if (v instanceof Date) return v.toISOString();
	if (typeof v === 'string') return v;
	return String(v);
}

function markerFile(key: string): FileRef {
	return new FileRef(BUCKET, key);
}

/** Strip leading `/` Surreal stores on object keys. */
function objectKey(key: string): string {
	return key.replace(/^\/+/, '');
}

/** GeoJSON Point or SDK GeometryPoint → {x,y}. */
export function pointFromGeometry(geom: unknown): MarkerPoint | null {
	if (!geom || typeof geom !== 'object') return null;
	if (geom instanceof GeometryPoint) {
		const [x, y] = geom.coordinates;
		const nx = asNumber(x);
		const ny = asNumber(y);
		if (nx === null || ny === null) return null;
		return { x: nx, y: ny };
	}
	const g = geom as { type?: string; coordinates?: unknown; point?: unknown };
	const coords = Array.isArray(g.coordinates)
		? g.coordinates
		: Array.isArray(g.point)
			? g.point
			: null;
	if (!coords || coords.length < 2) return null;
	const x = asNumber(coords[0]);
	const y = asNumber(coords[1]);
	if (x === null || y === null) return null;
	return { x, y };
}

function floorFromLevel(level: unknown): number | null {
	const key = recordKey(level, 'basemap_floor');
	if (!key) return null;
	return asNumber(key);
}

function bucketNameOf(v: unknown): string | null {
	if (v == null) return null;
	if (v instanceof FileRef) return v.bucket;
	if (typeof v === 'object') {
		const b = (v as { bucket?: unknown }).bucket;
		if (typeof b === 'string' && b) return b;
	}
	const s = asString(v);
	if (!s) return null;
	const m =
		s.match(/^f"([^"]+)"\//) ||
		s.match(/^([^:/]+):\//) ||
		s.match(/^([^/]+)\//);
	return m?.[1] ?? null;
}

/** True only for this project's marker image bucket. */
export function isMarkerImagesRef(v: unknown): boolean {
	const b = bucketNameOf(v);
	// bare object keys (no bucket) are treated as marker_images keys from our API
	if (b == null) return typeof v === 'string' && /^[a-zA-Z0-9._-]+$/.test(v);
	return b === BUCKET;
}

/** Pull object key from a CBOR `FileRef` (or legacy string forms). Rejects other buckets. */
export function fileKeyFromValue(v: unknown): string | null {
	if (v == null) return null;
	if (!isMarkerImagesRef(v)) return null;
	if (v instanceof FileRef) return objectKey(v.key);
	if (typeof v === 'object') {
		const o = v as { bucket?: unknown; key?: unknown };
		if (typeof o.key === 'string' && o.key) return objectKey(o.key);
	}
	const s = asString(v);
	if (!s) return null;
	const m =
		s.match(/^f"([^"]+)"\/(.+)$/) ||
		s.match(/^([^:/]+):\/+(.+)$/) ||
		s.match(/^([^/]+)\/(.+)$/);
	if (m) return objectKey(m[2]!);
	if (/^[a-zA-Z0-9._-]+$/.test(s)) return s;
	return null;
}

function safeObjectKey(key: string): string | null {
	const k = objectKey(key);
	if (!k || k.includes('..') || k.includes('/') || k.includes('\\')) return null;
	if (!/^[a-zA-Z0-9._-]+$/.test(k)) return null;
	return k;
}

function normalizeMarker(row: RawRow, viewCount = 0): MarkerRecord | null {
	const id = recordKey(row.id, 'markers');
	if (!id) return null;
	const pt = pointFromGeometry(row.geometry);
	if (!pt) return null;
	const floor = floorFromLevel(row.level);
	if (floor === null) return null;
	return {
		id,
		floor,
		zoneId: (() => {
			if (row.zone == null) return null;
			const z = recordKey(row.zone, 'zones');
			if (!z || z === 'NULL' || z === 'NONE') return null;
			return z;
		})(),
		x: roundPlanCoord(pt.x),
		y: roundPlanCoord(pt.y),
		label: asString(row.label),
		createdAt: asDatetime(row.created_at),
		updatedAt: asDatetime(row.updated_at),
		viewCount: asNumber(row.viewCount) ?? viewCount
	};
}

const QUEUE_STATUSES = new Set<EmbeddingQueueStatus>([
	'pending',
	'processing',
	'failed',
	'done'
]);

function asQueueStatus(v: unknown): EmbeddingQueueStatus | null {
	const s = asString(v);
	if (!s) return null;
	return QUEUE_STATUSES.has(s as EmbeddingQueueStatus) ? (s as EmbeddingQueueStatus) : null;
}

function normalizeView(row: RawRow): MarkerViewRecord | null {
	const id = recordKey(row.id, 'marker_views');
	if (!id) return null;
	const markerId = recordKey(row.marker, 'markers');
	if (!markerId) return null;
	const imageKey = fileKeyFromValue(row.image_url);
	// Join may arrive as nested object, array-of-one, or flat queue_status fields.
	const queueRaw = row.queue;
	const queueObj = Array.isArray(queueRaw)
		? ((queueRaw[0] as RawRow | undefined) ?? null)
		: queueRaw && typeof queueRaw === 'object'
			? (queueRaw as RawRow)
			: null;
	const queueStatus =
		asQueueStatus(queueObj?.status) ?? asQueueStatus(row.queue_status) ?? asQueueStatus(row.status);
	const queueError =
		asString(queueObj?.error_message) ?? asString(row.queue_error) ?? asString(row.error_message);
	return {
		id,
		markerId,
		imageKey,
		contentType: asString(row.content_type),
		imageHash: asString(row.image_hash),
		createdAt: asDatetime(row.created_at),
		imageUrl: imageKey ? `/api/marker-images/${encodeURIComponent(imageKey)}` : null,
		queueStatus,
		queueError
	};
}

export async function listMarkersByFloor(floor: number): Promise<MarkerRecord[]> {
	const rows = await query<RawRow[]>(
		`SELECT *,
			count((SELECT * FROM marker_views WHERE marker = $parent.id)) AS viewCount
		FROM markers
		WHERE level = type::record("basemap_floor", $floor)
		ORDER BY created_at ASC;`,
		{ floor }
	);
	const list = asList<RawRow>(rows);
	const out: MarkerRecord[] = [];
	for (const row of list) {
		const m = normalizeMarker(row);
		if (m) out.push(m);
	}
	return out;
}

export async function getMarker(id: string): Promise<MarkerRecord | null> {
	const rows = await query<RawRow[]>(
		`SELECT *,
			count((SELECT * FROM marker_views WHERE marker = $parent.id)) AS viewCount
		FROM type::record("markers", $id) LIMIT 1;`,
		{ id }
	);
	const row = rows[0]?.[0];
	return row ? normalizeMarker(row) : null;
}

export async function createMarker(input: {
	floor: number;
	x: number;
	y: number;
	label?: string | null;
	zoneId?: string | null;
}): Promise<MarkerRecord> {
	const label = input.label?.trim() || null;
	const zoneId = input.zoneId?.trim() || null;
	const x = roundPlanCoord(input.x);
	const y = roundPlanCoord(input.y);
	// JS null binds as Surreal NULL (not NONE) over CBOR — only set zone when present.
	const rows = await query<RawRow[]>(
		zoneId
			? `CREATE markers SET
				level = type::record("basemap_floor", $floor),
				zone = type::record("zones", $zoneId),
				geometry = type::point([$x, $y]),
				label = $label
			RETURN AFTER;`
			: `CREATE markers SET
				level = type::record("basemap_floor", $floor),
				zone = NONE,
				geometry = type::point([$x, $y]),
				label = $label
			RETURN AFTER;`,
		{
			floor: input.floor,
			x,
			y,
			label,
			...(zoneId ? { zoneId } : {})
		}
	);
	const row = rows[0]?.[0];
	const marker = row ? normalizeMarker(row, 0) : null;
	if (!marker) throw new Error('Failed to create marker');
	return marker;
}

export async function updateMarker(
	id: string,
	patch: { x?: number; y?: number; label?: string | null; zoneId?: string | null }
): Promise<MarkerRecord | null> {
	const sets: string[] = [];
	const vars: Record<string, unknown> = { id };

	if (patch.x !== undefined && patch.y !== undefined) {
		sets.push('geometry = type::point([$x, $y])');
		vars.x = roundPlanCoord(patch.x);
		vars.y = roundPlanCoord(patch.y);
	}
	if (patch.label !== undefined) {
		sets.push('label = $label');
		vars.label = patch.label?.trim() || null;
	}
	if (patch.zoneId !== undefined) {
		const z = patch.zoneId?.trim() || null;
		if (z) {
			sets.push('zone = type::record("zones", $zoneId)');
			vars.zoneId = z;
		} else {
			sets.push('zone = NONE');
		}
	}
	if (sets.length === 0) return getMarker(id);

	const rows = await query<RawRow[]>(
		`UPDATE type::record("markers", $id) SET ${sets.join(', ')} RETURN AFTER;`,
		vars
	);
	const row = rows[0]?.[0];
	return row ? normalizeMarker(row) : null;
}

export async function deleteMarker(id: string): Promise<boolean> {
	const views = await listViews(id);
	for (const v of views) {
		await deleteView(v.id);
	}
	await query(`DELETE type::record("markers", $id);`, { id });
	return true;
}

const VIEW_SELECT = `
	SELECT *,
		(SELECT status, error_message FROM ONLY type::record(
			'embedding_queue', record::id($parent.id)
		)) AS queue
	FROM marker_views
`;

export async function listViews(markerId: string): Promise<MarkerViewRecord[]> {
	const rows = await query<RawRow[]>(
		`${VIEW_SELECT}
		WHERE marker = type::record("markers", $markerId)
		ORDER BY created_at ASC;`,
		{ markerId }
	);
	const list = asList<RawRow>(rows);
	const out: MarkerViewRecord[] = [];
	for (const row of list) {
		const v = normalizeView(row);
		if (v) out.push(v);
	}
	return out;
}

export async function getView(id: string): Promise<MarkerViewRecord | null> {
	const rows = await query<RawRow[]>(
		`${VIEW_SELECT}
		WHERE id = type::record("marker_views", $id)
		LIMIT 1;`,
		{ id }
	);
	const row = asList<RawRow>(rows)[0] ?? rows[0]?.[0];
	return row ? normalizeView(row) : null;
}

export async function putBucketObject(key: string, bytes: Buffer | Uint8Array): Promise<void> {
	const safe = safeObjectKey(key);
	if (!safe) throw new Error('Invalid object key');
	const f = markerFile(safe);
	const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	await query(`RETURN file::put($f, $bytes);`, { f, bytes: data });
}

export async function deleteBucketObject(key: string): Promise<void> {
	const safe = safeObjectKey(key);
	if (!safe) return;
	try {
		await query(`RETURN file::delete($f);`, { f: markerFile(safe) });
	} catch {
		// best-effort
	}
}

function contentTypeFromKey(key: string, fallback?: string | null): string {
	const ext = key.includes('.') ? key.slice(key.lastIndexOf('.')).toLowerCase() : '';
	if (ext === '.png') return 'image/png';
	if (ext === '.webp') return 'image/webp';
	if (ext === '.gif') return 'image/gif';
	if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
	return fallback || 'application/octet-stream';
}

function bytesFromRpc(raw: unknown): Buffer | null {
	if (raw == null) return null;
	if (Buffer.isBuffer(raw)) return raw.length ? raw : null;
	if (raw instanceof ArrayBuffer) {
		const b = Buffer.from(raw);
		return b.length ? b : null;
	}
	if (raw instanceof Uint8Array) {
		const b = Buffer.from(raw);
		return b.length ? b : null;
	}
	return null;
}

export async function readImage(
	key: string
): Promise<{ bytes: Buffer; contentType: string } | null> {
	const safe = safeObjectKey(key);
	if (!safe) return null;
	try {
		const rows = await query<unknown>(`RETURN file::get($f);`, { f: markerFile(safe) });
		const bytes = bytesFromRpc(rows[0]);
		if (!bytes) return null;
		return { bytes, contentType: contentTypeFromKey(safe) };
	} catch {
		return null;
	}
}

export async function addView(input: {
	markerId: string;
	bytes: Buffer;
	contentType: string;
	ext?: string;
}): Promise<MarkerViewRecord> {
	const marker = await getMarker(input.markerId);
	if (!marker) throw new Error('Marker not found');

	const ext =
		input.ext ||
		(input.contentType.includes('png')
			? 'png'
			: input.contentType.includes('webp')
				? 'webp'
				: input.contentType.includes('gif')
					? 'gif'
					: 'jpg');
	const imageKey = `${randomUUID()}.${ext}`;
	const f = markerFile(imageKey);

	await putBucketObject(imageKey, input.bytes);

	try {
		// image_hash is computed by field DEFAULT/VALUE via fn::image_hash(file bytes)
		const rows = await query<RawRow[]>(
			`CREATE marker_views SET
				marker = type::record("markers", $markerId),
				image_url = $f,
				content_type = $contentType
			RETURN AFTER;`,
			{
				markerId: input.markerId,
				f,
				contentType: input.contentType
			}
		);
		const row = rows[0]?.[0];
		const created = row ? normalizeView(row) : null;
		if (!created) throw new Error('Failed to create marker view');
		// Re-read with queue join (event may have enqueued already).
		return (await getView(created.id)) ?? {
			...created,
			queueStatus: created.queueStatus ?? 'pending',
			queueError: created.queueError ?? null
		};
	} catch (err) {
		await deleteBucketObject(imageKey);
		throw err;
	}
}

export async function deleteView(id: string): Promise<boolean> {
	const view = await getView(id);
	if (!view) return false;
	// Event also deletes the file; explicit delete is fine if event misses legacy rows.
	if (view.imageKey) await deleteBucketObject(view.imageKey);
	await query(`DELETE type::record("marker_views", $id);`, { id });
	return true;
}

/** Ensure floor record exists before FK-ish level assignment. */
export async function floorExists(floor: number): Promise<boolean> {
	const rows = await query<{ number?: number }[]>(
		`SELECT number FROM type::record("basemap_floor", $floor) LIMIT 1;`,
		{ floor }
	);
	return Boolean(rows[0]?.[0]);
}

export { recordId };
