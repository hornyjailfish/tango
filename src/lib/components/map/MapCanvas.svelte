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
	let worldRef = $state.raw<Container | null>(null);
	let appRef = $state.raw<Application | null>(null);
	/** Last focusSeq we framed — re-fit when select/selectShop bumps it. */
	let fittedFocusSeq = $state.raw(0);
	let fitAnimRaf = 0;

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

	function cancelFitAnim(): void {
		if (fitAnimRaf) {
			cancelAnimationFrame(fitAnimRaf);
			fitAnimRaf = 0;
		}
	}

	function targetForBounds(
		bounds: { x: number; y: number; width: number; height: number },
		w: number,
		h: number,
		opts?: { pad?: number; padRight?: number; maxScale?: number; margin?: number }
	): { scale: number; x: number; y: number } {
		const pad = opts?.pad ?? 32;
		const padRight = opts?.padRight ?? pad;
		const maxScale = opts?.maxScale ?? 2;
		// >1 = pull back so the shop doesn't fill the viewport.
		const margin = opts?.margin ?? 1;
		const usableW = Math.max(w - pad - padRight, 1);
		const usableH = Math.max(h - pad * 2, 1);
		const bw = Math.max(bounds.width, 1) * margin;
		const bh = Math.max(bounds.height, 1) * margin;
		const scale = Math.min(usableW / bw, usableH / bh, maxScale);
		const cx = bounds.x + bounds.width / 2;
		const cy = bounds.y + bounds.height / 2;
		const viewCx = pad + usableW / 2;
		const viewCy = pad + usableH / 2;
		return { scale, x: viewCx - cx * scale, y: viewCy - cy * scale };
	}

	function applyWorld(world: Container, t: { scale: number; x: number; y: number }): void {
		world.scale.set(t.scale);
		world.position.set(t.x, t.y);
	}

	function easeOutCubic(t: number): number {
		return 1 - (1 - t) ** 3;
	}

	function animateWorldTo(
		world: Container,
		target: { scale: number; x: number; y: number },
		durationMs = 420
	): void {
		cancelFitAnim();
		const from = {
			scale: world.scale.x,
			x: world.position.x,
			y: world.position.y
		};
		// Skip animation if already essentially there (e.g. first paint).
		const dScale = Math.abs(from.scale - target.scale);
		const dPos = Math.hypot(from.x - target.x, from.y - target.y);
		if (dScale < 0.002 && dPos < 1.5) {
			applyWorld(world, target);
			return;
		}
		const start = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - start) / durationMs);
			const e = easeOutCubic(t);
			world.scale.set(from.scale + (target.scale - from.scale) * e);
			world.position.set(from.x + (target.x - from.x) * e, from.y + (target.y - from.y) * e);
			if (t < 1) {
				fitAnimRaf = requestAnimationFrame(step);
			} else {
				fitAnimRaf = 0;
				applyWorld(world, target);
			}
		};
		fitAnimRaf = requestAnimationFrame(step);
	}

	function fitBounds(
		world: Container,
		bounds: { x: number; y: number; width: number; height: number },
		w: number,
		h: number,
		opts?: {
			pad?: number;
			padRight?: number;
			maxScale?: number;
			margin?: number;
			smooth?: boolean;
			durationMs?: number;
		}
	): void {
		const target = targetForBounds(bounds, w, h, opts);
		if (opts?.smooth) animateWorldTo(world, target, opts.durationMs ?? 420);
		else {
			cancelFitAnim();
			applyWorld(world, target);
		}
	}

	/** Shop/POI footprint bounds in scene/world local coords (parents are untransformed). */
	function entityBounds(ent: FloorEntity): { x: number; y: number; width: number; height: number } {
		const b = ent.hit.getLocalBounds();
		return {
			x: b.x,
			y: b.y,
			width: Math.max(b.width, 8),
			height: Math.max(b.height, 8)
		};
	}

	function fitToSelection(id: string | null | undefined, smooth = true): boolean {
		const scene = sceneRef;
		const world = worldRef;
		const app = appRef;
		if (!scene || !world || !app || !id) return false;
		const ent = scene.entities.get(id);
		if (!ent) return false;
		fitBounds(world, entityBounds(ent), app.screen.width, app.screen.height, {
			pad: 128,
			padRight: 256,
			maxScale: 2.2,
			margin: 3.0,
			smooth,
			durationMs: 480
		});
		fittedFocusSeq = view.focusSeq;
		return true;
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
			worldRef = worldHost;
			appRef = app;

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
			const selId = view.selection?.id ?? null;
			setSelectionHighlight(scene, selId, highlightColor);
			// Prefer framing the current selection (e.g. search → floor jump); else whole floor.
			if (!fitToSelection(selId)) {
				fitBounds(worldHost, scene.bounds, app.screen.width, app.screen.height);
				fittedFocusSeq = view.focusSeq;
			}

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
				cancelFitAnim();
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
				cancelFitAnim();
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
			cancelFitAnim();
			sceneRef = null;
			worldRef = null;
			appRef = null;
			fittedFocusSeq = 0;
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
		const id = view.selection?.id ?? null;
		const seq = view.focusSeq;
		if (!s) return;
		setSelectionHighlight(s, id, highlightColor);
		if (!id) return;
		if (fittedFocusSeq === seq) return;
		fitToSelection(id);
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
