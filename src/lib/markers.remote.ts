import { command, query } from '$app/server';
import { z } from 'zod';
import {
	createMarker,
	deleteMarker,
	deleteView,
	floorExists,
	getMarker,
	listMarkersByFloor,
	listViews,
	updateMarker
} from '#lib/server/markers.js';
import type {
	EmbeddingQueueStatus,
	MarkerRecord,
	MarkerViewRecord
} from '#lib/types/markers.js';

const floorInput = z.object({
	floor: z.number().int()
});

const createInput = z.object({
	floor: z.number().int(),
	x: z.number().finite(),
	y: z.number().finite(),
	label: z.string().trim().max(120).nullable().optional()
});

const markerIdInput = z.object({
	id: z.string().trim().min(1).max(128)
});

const updateInput = z.object({
	id: z.string().trim().min(1).max(128),
	x: z.number().finite().optional(),
	y: z.number().finite().optional(),
	label: z.string().trim().max(120).nullable().optional()
});

export type { EmbeddingQueueStatus, MarkerRecord, MarkerViewRecord };

export const listMarkers = query(floorInput, async ({ floor }): Promise<MarkerRecord[]> => {
	return listMarkersByFloor(floor);
});

export const getMarkerById = query(markerIdInput, async ({ id }): Promise<MarkerRecord | null> => {
	return getMarker(id);
});

export const listMarkerViews = query(
	markerIdInput,
	async ({ id }): Promise<MarkerViewRecord[]> => {
		return listViews(id);
	}
);

export const placeMarker = command(createInput, async (input): Promise<MarkerRecord> => {
	if (!(await floorExists(input.floor))) {
		throw new Error(`Floor ${input.floor} is not in basemap cache`);
	}
	return createMarker({
		floor: input.floor,
		x: input.x,
		y: input.y,
		label: input.label ?? null
	});
});

export const patchMarker = command(updateInput, async (input): Promise<MarkerRecord | null> => {
	const { id, ...patch } = input;
	if (patch.x !== undefined || patch.y !== undefined) {
		if (patch.x === undefined || patch.y === undefined) {
			throw new Error('Both x and y are required to move a marker');
		}
	}
	return updateMarker(id, patch);
});

export const removeMarker = command(markerIdInput, async ({ id }): Promise<{ ok: true }> => {
	await deleteMarker(id);
	return { ok: true };
});

export const removeMarkerView = command(
	markerIdInput,
	async ({ id }): Promise<{ ok: true }> => {
		await deleteView(id);
		return { ok: true };
	}
);
