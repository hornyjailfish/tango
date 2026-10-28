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
}>({ floor: null, selection: null });

export function select(sel: Selection | null): void {
	view.selection = sel;
}
