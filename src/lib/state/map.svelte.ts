export type LayerKey = 'walls' | 'tenants' | 'poi' | 'walk';

export interface Selection {
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

export const layers = $state<Record<LayerKey, boolean>>({
	walls: true,
	tenants: true,
	poi: true,
	walk: true
});

export const view = $state<{
	floor: number | null;
	selection: Selection | null;
	/** Bumps whenever we should frame the selection on the map. */
	focusSeq: number;
}>({ floor: null, selection: null, focusSeq: 0 });

export function select(sel: Selection | null, opts?: { fit?: boolean }): void {
	view.selection = sel;
	if (sel && opts?.fit !== false) view.focusSeq += 1;
}

/** Ensure tenant layer is on, jump floor if known, then select + fit. */
export function selectShop(sel: Omit<Selection, 'kind' | 'cls'> & { cls?: string | null }): void {
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
