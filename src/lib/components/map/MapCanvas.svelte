<script lang="ts">
	import panzoom from '@panzoom/panzoom';
	import type { NormalizedFloor, NormalizedShop } from '#lib/tango/adapters/index.js';
	import { layers, view, select, type LayerKey, type Selection } from '#lib/state/map.svelte.js';

	let {
		floorData,
		shops
	}: { floorData: NormalizedFloor; shops: NormalizedShop[] } = $props();

	let container: HTMLDivElement | undefined = $state();

	const shopById = new Map(shops.map((s) => [s.id, s]));
	const OBJECT_CLASSES = new Set([
		'object',
		'kiosk',
		'atm',
		'toilet',
		'stairs',
		'escalator',
		'elevator',
		'travelator'
	]);

	let svgEl: SVGSVGElement | null = null;
	let pz: ReturnType<typeof panzoom> | null = null;
	let labelGroup: SVGGElement | null = null;
	const classified = new Map<Element, LayerKey>();

	function sanitize(raw: string): string {
		return raw
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
			.replace(/\son\w+\s*=\s*'[^']*'/gi, '')
			.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
	}

	function layerOf(el: Element): LayerKey | null {
		const id = el.getAttribute('id');
		const cls = (el.getAttribute('class') ?? '').split(/\s+/);
		if (id && /^floor\s*-?\d+$/i.test(id)) return null; // root wrapper — always visible
		if (id === 'over') return null;
		if (id === 'wall' || cls.includes('wall')) return 'walls';
		if (id && shopById.has(id)) return 'tenants';
		if (id && floorData.elements[id]) {
			const elementCls = floorData.elements[id].cls ?? '';
			return OBJECT_CLASSES.has(elementCls) ? 'poi' : 'tenants';
		}
		return null; // base geometry — always visible
	}

	function catHue(catId: string): number {
		let h = 0;
		for (let i = 0; i < catId.length; i++) h = (h * 31 + catId.charCodeAt(i)) % 360;
		return h;
	}

	function nodeXY(nodeId: string): { x: number; y: number } | null {
		const m = /^-?\d+-([0-9.]+)x([0-9.]+)$/.exec(nodeId);
		return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
	}

	function buildLabels(svg: SVGSVGElement): void {
		const NS = 'http://www.w3.org/2000/svg';
		const g = document.createElementNS(NS, 'g');
		g.setAttribute('data-layer', 'labels');
		for (const shop of shops) {
			if (shop.floor !== floorData.number) continue;
			const nodes = floorData.idToPoints[shop.id];
			if (!nodes?.length) continue;
			const xy = nodeXY(nodes[0]);
			if (!xy) continue;
			const text = document.createElementNS(NS, 'text');
			text.setAttribute('class', 'map-label');
			text.setAttribute('x', String(xy.x));
			text.setAttribute('y', String(xy.y));
			text.setAttribute('text-anchor', 'middle');
			text.textContent = shop.name;
			g.appendChild(text);
		}
		svg.appendChild(g);
		labelGroup = g;
	}

	function rebuild(): void {
		if (!container) return;
		pz?.destroy();
		pz = null;
		classified.clear();
		labelGroup = null;
		container.innerHTML = sanitize(floorData.svg);
		const svg = container.querySelector('svg');
		if (!svg) return;
		svgEl = svg;
		try {
			const bbox = svg.getBBox();
			if (bbox.width > 0 && bbox.height > 0) {
				svg.setAttribute(
					'viewBox',
					`${bbox.x - 20} ${bbox.y - 20} ${bbox.width + 40} ${bbox.height + 40}`
				);
			}
		} catch {
			/* getBBox unavailable — keep as-is */
		}
		svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
		for (const el of svg.querySelectorAll('[id]')) {
			const layer = layerOf(el);
			if (layer) classified.set(el, layer);
			if (layer === 'tenants') {
				const id = el.getAttribute('id');
				const cat = id ? (shopById.get(id)?.categories[0] ?? null) : null;
				if (cat) {
					el.setAttribute('data-cat', cat);
					(el as SVGElement).style.setProperty('--cat-hue', String(catHue(cat)));
				}
			}
		}
		buildLabels(svg);
		applyLayers();
		applySelection();
		pz = panzoom(svg, { maxZoom: 12, minZoom: 0.15 });
	}

	function applyLayers(): void {
		for (const [el, layer] of classified) {
			el.setAttribute('data-hidden', String(!layers[layer]));
		}
		labelGroup?.setAttribute('data-hidden', String(!layers.tenants));
		svgEl?.setAttribute('data-categories', String(layers.categories));
	}

	function applySelection(): void {
		if (!svgEl) return;
		for (const el of svgEl.querySelectorAll('[data-selected]')) el.removeAttribute('data-selected');
		const id = view.selection?.id;
		if (!id) return;
		for (const el of svgEl.querySelectorAll(`[id]`)) {
			if (el.getAttribute('id') === id) el.setAttribute('data-selected', 'true');
		}
	}

	function toSelection(id: string): Selection | null {
		const shop = shopById.get(id);
		if (shop) {
			return {
				kind: 'shop',
				id: shop.id,
				name: shop.name,
				floor: shop.floor,
				categories: shop.categories,
				description: shop.description,
				shortDescription: shop.shortDescription,
				logo: shop.logo,
				color: shop.color,
				roomNumber: shop.roomNumber,
				cls: null
			};
		}
		const element = floorData.elements[id];
		if (element) {
			return {
				kind: 'poi',
				id,
				name: element.cls ? `${element.cls} ${id}` : `object ${id}`,
				floor: floorData.number,
				categories: [],
				description: null,
				shortDescription: null,
				logo: null,
				color: null,
				roomNumber: null,
				cls: element.cls
			};
		}
		return null;
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') select(null);
	}

	function handleClick(e: MouseEvent): void {
		if (!svgEl) return;
		let el: Element | null = e.target as Element;
		while (el && el !== svgEl) {
			const id = el.getAttribute?.('id');
			if (id) {
				const sel = toSelection(id);
				select(sel);
				return;
			}
			el = el.parentElement;
		}
		select(null);
	}

	$effect(() => {
		void floorData;
		rebuild();
	});

	$effect(() => {
		void layers.walls;
		void layers.tenants;
		void layers.categories;
		void layers.poi;
		applyLayers();
	});

	$effect(() => {
		void view.selection;
		applySelection();
	});

	$effect(() => {
		return () => pz?.destroy();
	});
</script>

<div
	class="map-canvas relative size-full overflow-hidden bg-muted/30"
	bind:this={container}
	onclick={handleClick}
	onkeydown={handleKeydown}
	tabindex="0"
	role="application"
	aria-label="Mall basemap"
></div>