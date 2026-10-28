import { Container, Graphics } from 'pixi.js';
import type { NormalizedFloor, NormalizedShop } from '#lib/tango/adapters/index.js';
import {
	classifyHint,
	isFloorRootId,
	parseSvgId,
	POI_HINTS,
	sanitizeSvg
} from './svg-id.js';

export type MapLayerKey = 'walls' | 'tenants' | 'poi' | 'walk';

export type FloorEntity = {
	kind: 'shop' | 'poi';
	id: string;
	name: string;
	floor: number;
	categories: string[];
	description: string | null;
	shortDescription: string | null;
	logo: string | null;
	color: string | null;
	roomNumber: string | null;
	cls: string | null;
	/** Root container (visual + shape hit target). */
	graphic: Container;
	/** Full SVG group look. */
	visual: Graphics;
	/** Footprint-only graphic used for pointer hits. */
	hit: Graphics;
};

export type FloorScene = {
	world: Container;
	layers: Record<MapLayerKey | 'base' | 'highlight', Container>;
	entities: Map<string, FloorEntity>;
	bounds: { x: number; y: number; width: number; height: number };
	destroy: () => void;
};

function wrapSvg(inner: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

function serialize(el: Element): string {
	return new XMLSerializer().serializeToString(el);
}

function graphicsFrom(el: Element): Graphics | null {
	try {
		const g = new Graphics().svg(wrapSvg(serialize(el)));
		const b = g.getLocalBounds();
		if (b.width <= 0 && b.height <= 0) {
			g.destroy();
			return null;
		}
		return g;
	} catch {
		return null;
	}
}

function classesOf(el: Element): string[] {
	return (el.getAttribute('class') ?? '')
		.split(' ')
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Prefer Tango `shape` / `shape_N` (white plate); else first white fill. */
function pickShapeElement(group: Element): Element | null {
	const geos = group.querySelectorAll('path,polygon,polyline,rect,circle,ellipse');
	let white: Element | null = null;
	for (const el of geos) {
		const id = (el.getAttribute('id') ?? '').toLowerCase();
		if (id === 'shape' || id.startsWith('shape_') || id.startsWith('shape ')) {
			return el;
		}
		const fill = (el.getAttribute('fill') ?? '').trim().toLowerCase();
		if (
			!white &&
			(fill === 'white' || fill === '#fff' || fill === '#ffffff' || fill === 'rgb(255,255,255)')
		) {
			white = el;
		}
	}
	return white;
}

/** Visual = full group; hit = footprint path only (no bbox). */
function mountObject(
	groupEl: Element,
	parent: Container
): { root: Container; visual: Graphics; hit: Graphics } | null {
	const visual = graphicsFrom(groupEl);
	if (!visual) return null;
	visual.eventMode = 'none';

	const shapeEl = pickShapeElement(groupEl);
	const hit = (shapeEl ? graphicsFrom(shapeEl) : null) ?? graphicsFrom(groupEl);
	if (!hit) {
		visual.destroy();
		return null;
	}
	// Keep visible/renderable for Pixi hit tests; fully transparent so logos stay clean.
	hit.alpha = 0;
	hit.visible = true;
	hit.renderable = true;
	hit.eventMode = 'static';
	hit.cursor = 'pointer';

	const root = new Container();
	root.eventMode = 'passive';
	root.interactiveChildren = true;
	root.addChild(visual);
	root.addChild(hit);
	parent.addChild(root);
	return { root, visual, hit };
}

function toEntity(
	entityId: string,
	kind: 'shop' | 'poi',
	floor: NormalizedFloor,
	shopById: Map<string, NormalizedShop>,
	parts: { root: Container; visual: Graphics; hit: Graphics },
	cls: string | null
): FloorEntity {
	const shop = shopById.get(entityId);
	const base = {
		graphic: parts.root,
		visual: parts.visual,
		hit: parts.hit,
		cls: null as string | null
	};
	if (shop) {
		return {
			kind: 'shop',
			id: shop.id,
			name: shop.name,
			floor: shop.floor ?? floor.number,
			categories: shop.categories,
			description: shop.description,
			shortDescription: shop.shortDescription,
			logo: shop.logo,
			color: shop.color,
			roomNumber: shop.roomNumber,
			...base
		};
	}
	return {
		kind: kind === 'shop' ? 'shop' : 'poi',
		id: entityId,
		name: cls ? `${cls} ${entityId}` : entityId,
		floor: floor.number,
		categories: [],
		description: null,
		shortDescription: null,
		logo: null,
		color: null,
		roomNumber: null,
		...base,
		cls
	};
}

function bindEntity(
	entities: Map<string, FloorEntity>,
	entity: FloorEntity,
	onSelect: (entity: FloorEntity | null) => void
): void {
	// Hit uses path geometry only — never a bounding-box hitArea.
	entity.hit.on('pointertap', (e) => {
		e.stopPropagation();
		onSelect(entity);
	});
	if (!entities.has(entity.id)) entities.set(entity.id, entity);
}

/**
 * Build Pixi scene from Tango floor SVG structure:
 *   floor N
 *     over     → base plate + walls
 *     waypath  → walk graph (red/blue strokes)
 *     objects  → shop/POI groups `id(hint)`
 */
export function buildFloorScene(
	svgText: string,
	floor: NormalizedFloor,
	shops: NormalizedShop[],
	onSelect: (entity: FloorEntity | null) => void
): FloorScene {
	const shopById = new Map(shops.map((s) => [s.id, s]));
	const world = new Container();
	const layers = {
		base: new Container(),
		walls: new Container(),
		walk: new Container(),
		tenants: new Container(),
		poi: new Container(),
		highlight: new Container()
	};
	// bottom → top: plate, walls under content, then walk/shops/poi, highlight on top
	world.sortableChildren = true;
	layers.base.zIndex = 0;
	layers.walls.zIndex = 1;
	layers.walk.zIndex = 2;
	layers.tenants.zIndex = 3;
	layers.poi.zIndex = 4;
	layers.highlight.zIndex = 5;
	for (const c of Object.values(layers)) world.addChild(c);

	const entities = new Map<string, FloorEntity>();
	const doc = new DOMParser().parseFromString(sanitizeSvg(svgText), 'image/svg+xml');
	const root = doc.querySelector('svg') ?? doc.documentElement;

	// Prefer structured groups when present
	const over = root.querySelector('[id="over"]');
	const waypath = root.querySelector('[id="waypath"]');
	const objects = root.querySelector('[id="objects"]');

	// ── over: plate + walls ──────────────────────────────────────────
	if (over) {
		for (const child of [...over.children]) {
			const id = child.getAttribute('id') ?? '';
			const cls = classesOf(child);
			const isWall =
				id === 'wall' ||
				id.startsWith('wall ') ||
				cls.includes('wall') ||
				(parseSvgId(id)?.hint === 'wall');

			const g = graphicsFrom(child);
			if (!g) continue;
			g.eventMode = 'none';
			if (isWall) layers.walls.addChild(g);
			else layers.base.addChild(g);
		}
	}

	// ── waypath: walk graph ──────────────────────────────────────────
	if (waypath) {
		const g = graphicsFrom(waypath);
		if (g) {
			g.eventMode = 'none';
			layers.walk.addChild(g);
		}
	}

	// ── objects: one Graphics per tenant/POI group ───────────────────
	if (objects) {
		for (const child of [...objects.children]) {
			const rawId = child.getAttribute('id');
			if (!rawId || isFloorRootId(rawId)) continue;

			const parsed = parseSvgId(rawId);
			if (!parsed) continue;
			const { entityId, hint } = parsed;
			const cls = classesOf(child);
			const classHint = cls.find((c) => c === 'object' || POI_HINTS.has(c)) ?? null;
			const role = classifyHint(hint) ?? classifyHint(classHint);

			// skip pure logo-only groups without role? still draw if object class
			let layer: 'tenants' | 'poi' | null = null;
			if (role === 'tenant' || shopById.has(entityId) || cls.includes('object')) {
				layer = 'tenants';
			} else if (role === 'poi') {
				layer = 'poi';
			} else if (floor.elements[entityId]) {
				// element without clear hint → treat as POI-ish amenity
				layer = 'poi';
			} else {
				// unknown object still drawn on base so nothing vanishes
				const g = graphicsFrom(child);
				if (g) {
					g.eventMode = 'none';
					layers.base.addChild(g);
				}
				continue;
			}

			const parent = layer === 'tenants' ? layers.tenants : layers.poi;
			const parts = mountObject(child, parent);
			if (!parts) continue;

			const entity = toEntity(
				entityId,
				layer === 'tenants' ? 'shop' : 'poi',
				floor,
				shopById,
				parts,
				hint ?? classHint
			);
			bindEntity(entities, entity, onSelect);
		}
	} else {
		// Fallback: flat scan if structure missing (tests / odd floors)
		fallbackFlatScan(root, floor, shopById, layers, entities, onSelect);
	}

	const b = world.getLocalBounds();
	const bounds = {
		x: b.x,
		y: b.y,
		width: Math.max(b.width, 1),
		height: Math.max(b.height, 1)
	};

	return {
		world,
		layers,
		entities,
		bounds,
		destroy: () => {
			world.destroy({ children: true });
			entities.clear();
		}
	};
}

function fallbackFlatScan(
	root: Element,
	floor: NormalizedFloor,
	shopById: Map<string, NormalizedShop>,
	layers: FloorScene['layers'],
	entities: Map<string, FloorEntity>,
	onSelect: (entity: FloorEntity | null) => void
): void {
	const GEO = 'path,polygon,polyline,rect,circle,ellipse';
	for (const el of root.querySelectorAll(GEO)) {
		const rawId = el.getAttribute('id');
		const parsed = parseSvgId(rawId);
		if (!parsed) continue;
		const role = classifyHint(parsed.hint);
		if (!role && !shopById.has(parsed.entityId)) continue;
		const layer = role === 'poi' ? 'poi' : 'tenants';
		const parent = layer === 'poi' ? layers.poi : layers.tenants;
		// Flat scan: element itself is the footprint.
		const od = el.ownerDocument;
		const wrap = od.createElementNS('http://www.w3.org/2000/svg', 'g');
		wrap.appendChild(el.cloneNode(true));
		const parts = mountObject(wrap, parent);
		if (!parts) continue;
		const entity = toEntity(
			parsed.entityId,
			layer === 'poi' ? 'poi' : 'shop',
			floor,
			shopById,
			parts,
			parsed.hint
		);
		bindEntity(entities, entity, onSelect);
	}
}

export function setLayerVisibility(
	scene: FloorScene,
	vis: Record<MapLayerKey, boolean>
): void {
	scene.layers.walls.visible = vis.walls;
	scene.layers.tenants.visible = vis.tenants;
	scene.layers.poi.visible = vis.poi;
	scene.layers.walk.visible = vis.walk;
}

/** `#f9c416` → 0xf9c416 — no regex. */
export function cssHexToPixi(hex: string, fallback = 0xf9c416): number {
	let h = hex.trim();
	if (h.startsWith('#')) h = h.slice(1);
	if (h.length === 3) {
		h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	}
	if (h.length !== 6) return fallback;
	const n = Number.parseInt(h, 16);
	return Number.isFinite(n) ? n : fallback;
}

export function setSelectionHighlight(
	scene: FloorScene,
	id: string | null,
	highlightHex = '#f9c416'
): void {
	const prev = scene.layers.highlight.removeChildren();
	for (const c of prev) c.destroy();
	for (const ent of scene.entities.values()) {
		ent.visual.tint = 0xffffff;
	}
	if (!id) return;
	const ent = scene.entities.get(id);
	if (!ent) return;
	const color = cssHexToPixi(highlightHex);
	ent.visual.tint = color;
	const box = ent.hit.getLocalBounds();
	const ring = new Graphics()
		.rect(box.x - 2, box.y - 2, box.width + 4, box.height + 4)
		.stroke({ width: 3, color, alpha: 0.95 });
	ring.eventMode = 'none';
	scene.layers.highlight.addChild(ring);
}
