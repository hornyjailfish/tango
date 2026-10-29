import type { MarkerRecord } from '#lib/types/markers.js';

export type LayerKey = 'walls' | 'tenants' | 'poi' | 'walk' | 'markers';

export type Selection =
	| {
			kind: 'shop' | 'poi';
			id: string;
			name: string;
			floor: number | null;
			categories: string[];
			description: string | null;
			shortDescription: string | null;
			logo: string | null;
			color: string | null;
			roomNumber: string | null;
			cls: string | null;
	  }
	| {
			kind: 'marker';
			id: string;
			name: string;
			floor: number | null;
			x: number;
			y: number;
			viewCount: number;
			label: string | null;
	  };

export const layers = $state<Record<LayerKey, boolean>>({
	walls: true,
	tenants: true,
	poi: true,
	walk: true,
	markers: true
});

export const view = $state<{
	floor: number | null;
	selection: Selection | null;
	/** Bumps whenever we should frame the selection on the map. */
	focusSeq: number;
	/** Next map click places a VPR marker instead of selecting a shop. */
	placeMarkerMode: boolean;
	/** When set, next map click moves this marker (id) instead of selecting. */
	moveMarkerId: string | null;
	/** In-memory markers for current floor (refreshed from remote). */
	markers: MarkerRecord[];
	markersSeq: number;
}>({
	floor: null,
	selection: null,
	focusSeq: 0,
	placeMarkerMode: false,
	moveMarkerId: null,
	markers: [],
	markersSeq: 0
});

export function select(sel: Selection | null, opts?: { fit?: boolean }): void {
	view.selection = sel;
	// Leave move mode if selection is cleared or switches away from the moving pin.
	if (
		view.moveMarkerId &&
		(!sel || sel.kind !== 'marker' || sel.id !== view.moveMarkerId)
	) {
		view.moveMarkerId = null;
	}
	if (sel && opts?.fit !== false) view.focusSeq += 1;
}

/** Ensure tenant layer is on, jump floor if known, then select + fit. */
export function selectShop(sel: Omit<Extract<Selection, { kind: 'shop' | 'poi' }>, 'kind' | 'cls'> & {
	cls?: string | null;
}): void {
	layers.tenants = true;
	if (sel.floor !== null && sel.floor !== undefined) {
		view.floor = sel.floor;
	}
	select({
		kind: 'shop',
		id: sel.id,
		name: sel.name,
		floor: sel.floor,
		categories: sel.categories,
		description: sel.description,
		shortDescription: sel.shortDescription,
		logo: sel.logo,
		color: sel.color,
		roomNumber: sel.roomNumber,
		cls: sel.cls ?? null
	});
}

export function selectMarker(m: MarkerRecord, opts?: { fit?: boolean }): void {
	layers.markers = true;
	if (m.floor !== null && m.floor !== undefined) {
		view.floor = m.floor;
	}
	// Markers never auto-fit the camera (pins stay under the cursor / current view).
	select(
		{
			kind: 'marker',
			id: m.id,
			name: m.label?.trim() || `Marker ${m.id.slice(0, 8)}`,
			floor: m.floor,
			x: m.x,
			y: m.y,
			viewCount: m.viewCount,
			label: m.label
		},
		{ fit: opts?.fit === true }
	);
}

export function setMarkers(list: MarkerRecord[]): void {
	view.markers = list;
	view.markersSeq += 1;
}

function markerDataEqual(a: MarkerRecord, b: MarkerRecord): boolean {
	return (
		a.id === b.id &&
		a.x === b.x &&
		a.y === b.y &&
		a.label === b.label &&
		a.viewCount === b.viewCount &&
		a.zoneId === b.zoneId &&
		a.floor === b.floor
	);
}

/** Insert or replace one marker and bump seq so the Pixi layer re-syncs immediately. */
export function upsertMarker(marker: MarkerRecord): void {
	const i = view.markers.findIndex((m) => m.id === marker.id);
	if (i === -1) {
		view.markers = [...view.markers, marker];
		view.markersSeq += 1;
	} else if (!markerDataEqual(view.markers[i], marker)) {
		const next = view.markers.slice();
		next[i] = marker;
		view.markers = next;
		view.markersSeq += 1;
	}

	// Patch open selection in place — avoid selectMarker (layers/floor/focus side effects).
	const s = view.selection;
	if (s?.kind === 'marker' && s.id === marker.id) {
		const name = marker.label?.trim() || `Marker ${marker.id.slice(0, 8)}`;
		if (
			s.name !== name ||
			s.viewCount !== marker.viewCount ||
			s.x !== marker.x ||
			s.y !== marker.y ||
			s.label !== marker.label ||
			s.floor !== marker.floor
		) {
			view.selection = {
				kind: 'marker',
				id: marker.id,
				name,
				floor: marker.floor,
				x: marker.x,
				y: marker.y,
				viewCount: marker.viewCount,
				label: marker.label
			};
		}
	}
}

export function removeMarkerLocal(id: string): void {
	const next = view.markers.filter((m) => m.id !== id);
	if (next.length !== view.markers.length) {
		view.markers = next;
		view.markersSeq += 1;
	}
	if (view.selection?.kind === 'marker' && view.selection.id === id) {
		view.selection = null;
	}
}

export function togglePlaceMarkerMode(on?: boolean): void {
	const next = on ?? !view.placeMarkerMode;
	view.placeMarkerMode = next;
	if (next) view.moveMarkerId = null;
}

/** Enter move mode for an existing marker (cancels place mode). */
export function startMoveMarker(id: string): void {
	view.placeMarkerMode = false;
	view.moveMarkerId = id;
	layers.markers = true;
}

export function cancelMoveMarker(): void {
	view.moveMarkerId = null;
}
