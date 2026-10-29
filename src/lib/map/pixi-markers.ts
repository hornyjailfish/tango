import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { MarkerRecord } from '#lib/types/markers.js';

export type MarkerGraphic = {
	id: string;
	root: Container;
	/** Screen-space body (pin + label); counter-scaled vs world zoom. */
	body: Container;
	pin: Graphics;
	label: Text;
	x: number;
	y: number;
};

export type MarkersLayer = {
	container: Container;
	byId: Map<string, MarkerGraphic>;
	/** Last world scale applied to pin/label screen size. */
	worldScale: number;
	destroy: () => void;
};

const PIN_COLOR = 0x2563eb;
const PIN_SELECTED = 0xf59e0b;
const PIN_R = 9;

/** Clamp inverse scale so pins stay usable when fully zoomed out/in. */
const SCREEN_SCALE_MIN = 0.2;
const SCREEN_SCALE_MAX = 8;

const labelStyle = new TextStyle({
	fontFamily: 'system-ui, Segoe UI, sans-serif',
	fontSize: 13,
	fill: 0x0f172a,
	fontWeight: '600',
	stroke: { color: 0xffffff, width: 3 },
	align: 'center',
	padding: 2
});

function drawPin(g: Graphics, selected: boolean, hasViews: boolean): void {
	g.clear();
	const color = selected ? PIN_SELECTED : PIN_COLOR;
	// teardrop pin, tip at (0,0) so geometry point is the placement
	g.moveTo(0, 0);
	g.bezierCurveTo(-10, -14, -12, -28, 0, -30);
	g.bezierCurveTo(12, -28, 10, -14, 0, 0);
	g.fill({ color, alpha: 0.95 });
	g.circle(0, -22, 5);
	g.fill({ color: 0xffffff, alpha: 1 });
	// hit pad (screen-space with body)
	g.circle(0, -18, PIN_R + 6);
	g.fill({ color: 0xffffff, alpha: 0.001 });
	if (hasViews) {
		g.circle(0, -22, 4);
		g.fill({ color: 0x22c55e, alpha: 1 });
	}
}

function screenScaleForWorld(worldScale: number): number {
	const inv = 1 / Math.max(worldScale, 1e-6);
	return Math.min(SCREEN_SCALE_MAX, Math.max(SCREEN_SCALE_MIN, inv));
}

export function createMarkersLayer(): MarkersLayer {
	const container = new Container();
	container.sortableChildren = true;
	container.zIndex = 20;
	container.eventMode = 'passive';
	const byId = new Map<string, MarkerGraphic>();

	return {
		container,
		byId,
		worldScale: 1,
		destroy: () => {
			container.destroy({ children: true });
			byId.clear();
		}
	};
}

/** Keep pins/labels ~constant screen size under map zoom. Call after any world scale change. */
export function setMarkersScreenScale(layer: MarkersLayer, worldScale: number): void {
	layer.worldScale = worldScale;
	const s = screenScaleForWorld(worldScale);
	for (const g of layer.byId.values()) {
		g.body.scale.set(s);
	}
}

export function syncMarkers(
	layer: MarkersLayer,
	markers: MarkerRecord[],
	opts: {
		selectedId?: string | null;
		onSelect?: (marker: MarkerRecord) => void;
		worldScale?: number;
	} = {}
): void {
	const selectedId = opts.selectedId ?? null;
	if (opts.worldScale != null) layer.worldScale = opts.worldScale;
	const bodyScale = screenScaleForWorld(layer.worldScale);
	const keep = new Set(markers.map((m) => m.id));

	for (const [id, g] of layer.byId) {
		if (!keep.has(id)) {
			g.root.destroy({ children: true });
			layer.byId.delete(id);
		}
	}

	for (const m of markers) {
		let entry = layer.byId.get(m.id);
		if (!entry) {
			const root = new Container();
			root.eventMode = 'static';
			root.cursor = 'pointer';

			const body = new Container();
			// Interactive child so hit-test finds the pin under world scale.
			body.eventMode = 'static';
			const pin = new Graphics();
			pin.eventMode = 'static';
			const label = new Text({
				text: m.label?.trim() || '',
				style: labelStyle,
				resolution: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 2 : 2, 3),
				roundPixels: true
			});
			label.anchor.set(0.5, 1);
			label.position.set(0, -34);
			label.visible = Boolean(m.label?.trim());
			label.eventMode = 'none';

			body.addChild(pin);
			body.addChild(label);
			body.scale.set(bodyScale);
			root.addChild(body);

			entry = { id: m.id, root, body, pin, label, x: m.x, y: m.y };
			layer.byId.set(m.id, entry);
			layer.container.addChild(root);
		}

		entry.x = m.x;
		entry.y = m.y;
		entry.root.position.set(m.x, m.y);
		entry.body.scale.set(bodyScale);
		drawPin(entry.pin, m.id === selectedId, m.viewCount > 0);

		const text = m.label?.trim() || '';
		entry.label.text = text;
		entry.label.visible = Boolean(text);

		entry.root.removeAllListeners('pointertap');
		entry.root.on('pointertap', (e) => {
			e.stopPropagation();
			opts.onSelect?.(m);
		});
	}
}
