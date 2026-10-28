<script lang="ts">
	import { Application, Container } from 'pixi.js';
	import type { NormalizedFloor, NormalizedShop } from '#lib/tango/adapters/index.js';
	import {
		buildFloorScene,
		setLayerVisibility,
		setSelectionHighlight,
		type FloorEntity,
		type FloorScene
	} from '#lib/map/pixi-floor.js';
	import { layers, view, select } from '#lib/state/map.svelte.js';

	let {
		floorData,
		shops,
		highlightColor = '#f9c416'
	}: {
		floorData: NormalizedFloor;
		shops: NormalizedShop[];
		highlightColor?: string;
	} = $props();

	let host: HTMLDivElement | undefined = $state();
	let sceneRef = $state.raw<FloorScene | null>(null);

	function entityToSelection(e: FloorEntity) {
		return {
			kind: e.kind,
			id: e.id,
			name: e.name,
			floor: e.floor,
			categories: e.categories,
			description: e.description,
			shortDescription: e.shortDescription,
			logo: e.logo,
			color: e.color,
			roomNumber: e.roomNumber,
			cls: e.cls
		};
	}

	function fitWorld(
		world: Container,
		bounds: { x: number; y: number; width: number; height: number },
		w: number,
		h: number
	): void {
		const pad = 32;
		const sx = (w - pad * 2) / bounds.width;
		const sy = (h - pad * 2) / bounds.height;
		const scale = Math.min(sx, sy, 2);
		world.scale.set(scale);
		world.position.set(
			w / 2 - (bounds.x + bounds.width / 2) * scale,
			h / 2 - (bounds.y + bounds.height / 2) * scale
		);
	}

	$effect(() => {
		const el = host;
		const floor = floorData;
		const shopList = shops;
		if (!el) return;

		let dead = false;
		let app: Application | null = null;
		let scene: FloorScene | null = null;
		let worldHost: Container | null = null;
		let panning = false;
		let panLast = { x: 0, y: 0 };
		let dragMoved = false;

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') select(null);
		};

		(async () => {
			const application = new Application();
			await application.init({
				resizeTo: el,
				background: 0xe8e6e9,
				antialias: true,
				resolution: Math.min(window.devicePixelRatio || 1, 2),
				autoDensity: true,
				preference: 'webgl'
			});
			if (dead) {
				application.destroy(true);
				return;
			}
			app = application;
			el.appendChild(app.canvas);
			const canvas = app.canvas as HTMLCanvasElement;
			canvas.classList.add('map-pixi-canvas');
			canvas.style.display = 'block';
			canvas.style.width = '100%';
			canvas.style.height = '100%';
			canvas.tabIndex = 0;
			canvas.setAttribute('aria-label', 'Mall basemap');
			canvas.style.touchAction = 'none';
			canvas.style.cursor = 'grab';

			worldHost = new Container();
			app.stage.addChild(worldHost);
			app.stage.eventMode = 'static';
			app.stage.hitArea = app.screen;

			scene = buildFloorScene(floor.svg, floor, shopList, (entity) => {
				if (panning || dragMoved) return;
				select(entity ? entityToSelection(entity) : null);
			});
			sceneRef = scene;
			worldHost.addChild(scene.world);
			setLayerVisibility(scene, {
				walls: layers.walls,
				tenants: layers.tenants,
				poi: layers.poi,
				walk: layers.walk
			});
			setSelectionHighlight(scene, view.selection?.id ?? null, highlightColor);
			fitWorld(worldHost, scene.bounds, app.screen.width, app.screen.height);

			const onPointerDown = (ev: PointerEvent) => {
				dragMoved = false;
				panning = false;
				panLast = { x: ev.clientX, y: ev.clientY };
				canvas.setPointerCapture?.(ev.pointerId);
			};

			const onPointerMove = (ev: PointerEvent) => {
				if ((ev.buttons & 1) === 0 && (ev.buttons & 4) === 0) return;
				if (!worldHost) return;
				const dx = ev.clientX - panLast.x;
				const dy = ev.clientY - panLast.y;
				if (!dragMoved && Math.hypot(dx, dy) < 4) return;
				dragMoved = true;
				panning = true;
				panLast = { x: ev.clientX, y: ev.clientY };
				worldHost.position.x += dx;
				worldHost.position.y += dy;
				canvas.style.cursor = 'grabbing';
			};

			const resolveEntity = (hit: Container | null | undefined): FloorEntity | null => {
				if (!hit || !scene) return null;
				let node: Container | null = hit;
				while (node) {
					for (const ent of scene.entities.values()) {
						if (ent.graphic === node || ent.hit === node || ent.visual === node) return ent;
					}
					node = node.parent;
				}
				return null;
			};

			const onPointerUp = (ev: PointerEvent) => {
				if (!dragMoved && ev.button === 0 && app) {
					const rect = canvas.getBoundingClientRect();
					const cssX = ev.clientX - rect.left;
					const cssY = ev.clientY - rect.top;
					const hit = app.renderer.events.rootBoundary.hitTest(cssX, cssY);
					const entity = resolveEntity(hit as Container | null);
					select(entity ? entityToSelection(entity) : null);
				}
				dragMoved = false;
				panning = false;
				canvas.style.cursor = 'grab';
			};

			const onWheel = (ev: WheelEvent) => {
				if (!worldHost) return;
				ev.preventDefault();
				const rect = canvas.getBoundingClientRect();
				const mx = ev.clientX - rect.left;
				const my = ev.clientY - rect.top;
				const scale = worldHost.scale.x;
				const next = Math.min(12, Math.max(0.05, scale * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
				const wx = (mx - worldHost.position.x) / scale;
				const wy = (my - worldHost.position.y) / scale;
				worldHost.scale.set(next);
				worldHost.position.set(mx - wx * next, my - wy * next);
			};

			const onContext = (ev: Event) => ev.preventDefault();

			canvas.addEventListener('pointerdown', onPointerDown);
			canvas.addEventListener('pointermove', onPointerMove);
			canvas.addEventListener('pointerup', onPointerUp);
			canvas.addEventListener('pointercancel', onPointerUp);
			canvas.addEventListener('wheel', onWheel, { passive: false });
			canvas.addEventListener('contextmenu', onContext);
			window.addEventListener('keydown', onKeyDown);

			(app as Application & { __dispose?: () => void }).__dispose = () => {
				canvas.removeEventListener('pointerdown', onPointerDown);
				canvas.removeEventListener('pointermove', onPointerMove);
				canvas.removeEventListener('pointerup', onPointerUp);
				canvas.removeEventListener('pointercancel', onPointerUp);
				canvas.removeEventListener('wheel', onWheel);
				canvas.removeEventListener('contextmenu', onContext);
				window.removeEventListener('keydown', onKeyDown);
			};
		})().catch((err) => console.error('Pixi map init failed', err));

		return () => {
			dead = true;
			sceneRef = null;
			const a = app as (Application & { __dispose?: () => void }) | null;
			a?.__dispose?.();
			scene?.destroy();
			if (app) app.destroy(true, { children: true });
			el.replaceChildren();
		};
	});

	$effect(() => {
		const s = sceneRef;
		if (!s) return;
		setLayerVisibility(s, {
			walls: layers.walls,
			tenants: layers.tenants,
			poi: layers.poi,
			walk: layers.walk
		});
	});

	$effect(() => {
		const s = sceneRef;
		if (!s) return;
		setSelectionHighlight(s, view.selection?.id ?? null, highlightColor);
	});
</script>

<div
	class="map-canvas relative size-full overflow-hidden bg-muted/30"
	bind:this={host}
	role="application"
	aria-label="Mall basemap"
></div>

<style>
	.map-canvas :global(canvas.map-pixi-canvas) {
		width: 100%;
		height: 100%;
	}
</style>
