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
	import {
		createMarkersLayer,
		setMarkersScreenScale,
		syncMarkers,
		type MarkersLayer
	} from '#lib/map/pixi-markers.js';
	import {
		cancelMoveMarker,
		layers,
		view,
		select,
		selectMarker,
		setMarkers,
		upsertMarker,
		togglePlaceMarkerMode
	} from '#lib/state/map.svelte.js';
	import { listMarkers, patchMarker, placeMarker } from '#lib/markers.remote.js';

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
	let markersRef = $state.raw<MarkersLayer | null>(null);
	/** Last focusSeq we framed — re-fit when select/selectShop bumps it. */
	let fittedFocusSeq = $state.raw(0);
	let fitAnimRaf = 0;
	let placing = $state(false);
	let moving = $state(false);

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
		if (markersRef) setMarkersScreenScale(markersRef, t.scale);
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
			const scale = from.scale + (target.scale - from.scale) * e;
			world.scale.set(scale);
			world.position.set(from.x + (target.x - from.x) * e, from.y + (target.y - from.y) * e);
			if (markersRef) setMarkersScreenScale(markersRef, scale);
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

	function markerBounds(x: number, y: number): { x: number; y: number; width: number; height: number } {
		return { x: x - 24, y: y - 40, width: 48, height: 48 };
	}

	function fitToSelection(id: string | null | undefined, smooth = true): boolean {
		// Caller owns fittedFocusSeq when invoked from the focus effect.
		const scene = sceneRef;
		const world = worldRef;
		const app = appRef;
		if (!scene || !world || !app || !id) return false;

		const sel = view.selection;
		// Marker pins: only when caller requested fit (select fit:true → focusSeq bump).
		if (sel?.kind === 'marker') {
			if (sel.id !== id) return false;
			fitBounds(world, markerBounds(sel.x, sel.y), app.screen.width, app.screen.height, {
				pad: 160,
				padRight: 280,
				maxScale: 2.4,
				margin: 2.5,
				smooth,
				durationMs: 480
			});
			fittedFocusSeq = view.focusSeq;
			return true;
		}

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

	function screenToWorld(
		world: Container,
		canvas: HTMLCanvasElement,
		clientX: number,
		clientY: number
	): { x: number; y: number } {
		const rect = canvas.getBoundingClientRect();
		const mx = clientX - rect.left;
		const my = clientY - rect.top;
		const scale = world.scale.x || 1;
		return {
			x: (mx - world.position.x) / scale,
			y: (my - world.position.y) / scale
		};
	}

	async function refreshMarkers(floor: number): Promise<void> {
		try {
			// Bust remote query cache so we don't paint a stale list after writes.
			const q = listMarkers({ floor });
			await q.refresh();
			const list = await q;
			if (view.floor === floor) setMarkers(list);
		} catch (err) {
			console.error('Failed to load markers', err);
		}
	}

	async function placeAt(floor: number, x: number, y: number): Promise<void> {
		if (placing || moving) return;
		placing = true;
		try {
			const marker = await placeMarker({ floor, x, y, label: null });
			// Paint immediately from the command result — don't wait on list refetch.
			upsertMarker(marker);
			togglePlaceMarkerMode(false);
			selectMarker(marker);
			// Background reconcile with server list (cache-busted).
			void refreshMarkers(floor);
		} catch (err) {
			console.error('Failed to place marker', err);
		} finally {
			placing = false;
		}
	}

	async function moveTo(id: string, floor: number, x: number, y: number): Promise<void> {
		if (placing || moving) return;
		moving = true;
		const prev = view.markers.find((m) => m.id === id) ?? null;
		// Optimistic pin move so the map feels instant.
		if (prev) upsertMarker({ ...prev, x, y });
		try {
			const updated = await patchMarker({ id, x, y });
			if (updated) upsertMarker(updated);
			else await refreshMarkers(floor);
			cancelMoveMarker();
		} catch (err) {
			console.error('Failed to move marker', err);
			if (prev) upsertMarker(prev);
			else void refreshMarkers(floor);
		} finally {
			moving = false;
		}
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
		let markersLayer: MarkersLayer | null = null;
		let panning = false;
		let panLast = { x: 0, y: 0 };
		let dragMoved = false;

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				if (view.moveMarkerId) cancelMoveMarker();
				else if (view.placeMarkerMode) togglePlaceMarkerMode(false);
				else select(null);
			}
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
			worldHost.sortableChildren = true;
			app.stage.addChild(worldHost);
			app.stage.eventMode = 'static';
			app.stage.hitArea = app.screen;
			worldRef = worldHost;
			appRef = app;

			scene = buildFloorScene(floor.svg, floor, shopList, (entity) => {
				if (panning || dragMoved || view.placeMarkerMode || view.moveMarkerId) return;
				select(entity ? entityToSelection(entity) : null);
			});
			sceneRef = scene;
			scene.world.zIndex = 0;
			worldHost.addChild(scene.world);

			markersLayer = createMarkersLayer();
			markersRef = markersLayer;
			worldHost.addChild(markersLayer.container);
			syncMarkers(markersLayer, view.markers, {
				selectedId: view.selection?.kind === 'marker' ? view.selection.id : null,
				worldScale: worldHost.scale.x,
				onSelect: (m) => {
					if (view.placeMarkerMode || view.moveMarkerId) return;
					selectMarker(m);
				}
			});

			setLayerVisibility(scene, {
				walls: layers.walls,
				tenants: layers.tenants,
				poi: layers.poi,
				walk: layers.walk
			});
			markersLayer.container.visible = layers.markers;

			const selId = view.selection?.id ?? null;
			if (view.selection?.kind !== 'marker') {
				setSelectionHighlight(scene, selId, highlightColor);
			} else {
				setSelectionHighlight(scene, null, highlightColor);
			}
			// Prefer framing the current selection (e.g. search → floor jump); else whole floor.
			if (!fitToSelection(selId)) {
				fitBounds(worldHost, scene.bounds, app.screen.width, app.screen.height);
				fittedFocusSeq = view.focusSeq;
			}

			void refreshMarkers(floor.number);

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

			const resolveMarkerId = (hit: Container | null | undefined): string | null => {
				if (!hit || !markersLayer) return null;
				let node: Container | null = hit;
				while (node) {
					for (const g of markersLayer.byId.values()) {
						if (g.root === node || g.body === node || g.pin === node || g.label === node)
							return g.id;
					}
					node = node.parent;
				}
				return null;
			};

			const onPointerUp = (ev: PointerEvent) => {
				if (!dragMoved && ev.button === 0 && app && worldHost) {
					const moveId = view.moveMarkerId;
					if (moveId) {
						const pt = screenToWorld(worldHost, canvas, ev.clientX, ev.clientY);
						void moveTo(moveId, floor.number, pt.x, pt.y);
					} else if (view.placeMarkerMode) {
						const pt = screenToWorld(worldHost, canvas, ev.clientX, ev.clientY);
						void placeAt(floor.number, pt.x, pt.y);
					} else {
						const rect = canvas.getBoundingClientRect();
						const cssX = ev.clientX - rect.left;
						const cssY = ev.clientY - rect.top;
						const hit = app.renderer.events.rootBoundary.hitTest(cssX, cssY);
						const markerId = resolveMarkerId(hit as Container | null);
						if (markerId) {
							const m = view.markers.find((x) => x.id === markerId);
							if (m) selectMarker(m);
						} else {
							const entity = resolveEntity(hit as Container | null);
							select(entity ? entityToSelection(entity) : null);
						}
					}
				}
				dragMoved = false;
				panning = false;
				canvas.style.cursor =
					view.placeMarkerMode || view.moveMarkerId ? 'crosshair' : 'grab';
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
				if (markersLayer) setMarkersScreenScale(markersLayer, next);
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
			markersRef = null;
			fittedFocusSeq = 0;
			const a = app as (Application & { __dispose?: () => void }) | null;
			a?.__dispose?.();
			markersLayer?.destroy();
			scene?.destroy();
			if (app) app.destroy(true, { children: true });
			el.replaceChildren();
		};
	});

	$effect(() => {
		const s = sceneRef;
		const m = markersRef;
		if (!s) return;
		setLayerVisibility(s, {
			walls: layers.walls,
			tenants: layers.tenants,
			poi: layers.poi,
			walk: layers.walk
		});
		if (m) m.container.visible = layers.markers;
	});

	$effect(() => {
		const m = markersRef;
		const list = view.markers;
		const seq = view.markersSeq;
		const selectedId = view.selection?.kind === 'marker' ? view.selection.id : null;
		void seq;
		if (!m) return;
		syncMarkers(m, list, {
			selectedId,
			worldScale: worldRef?.scale.x ?? m.worldScale,
			onSelect: (marker) => {
				if (view.placeMarkerMode || view.moveMarkerId) return;
				selectMarker(marker);
			}
		});
	});

	$effect(() => {
		const s = sceneRef;
		const id = view.selection?.id ?? null;
		const seq = view.focusSeq;
		const kind = view.selection?.kind;
		if (!s) return;
		// Markers use pin chrome, not shop polygon highlight.
		if (kind === 'marker') {
			setSelectionHighlight(s, null, highlightColor);
		} else {
			setSelectionHighlight(s, id, highlightColor);
		}
		if (!id) return;
		// Read via untracked compare path: fitToSelection writes fittedFocusSeq.
		if (fittedFocusSeq === seq) return;
		// Mark before fit so a failed/no-op fit cannot re-enter forever.
		fittedFocusSeq = seq;
		// Shop/poi always fit; markers only when select(..., { fit: true }) bumped focusSeq
		// (e.g. VPR search). Pin clicks use fit:false so focusSeq stays unchanged.
		fitToSelection(id, true);
	});

	$effect(() => {
		const canvas = host?.querySelector('canvas.map-pixi-canvas') as HTMLCanvasElement | null;
		if (!canvas) return;
		if (view.placeMarkerMode || view.moveMarkerId) canvas.style.cursor = 'crosshair';
		else canvas.style.cursor = 'grab';
	});

	// Drop move mode if the target marker is no longer selected / gone.
	$effect(() => {
		const moveId = view.moveMarkerId;
		if (!moveId) return;
		const stillThere = view.markers.some((m) => m.id === moveId);
		const stillSelected =
			view.selection?.kind === 'marker' && view.selection.id === moveId;
		if (!stillThere || !stillSelected) cancelMoveMarker();
	});

	// Floor change → reload markers for that floor
	$effect(() => {
		const n = floorData.number;
		void refreshMarkers(n);
	});
</script>

<div
	class="map-canvas relative size-full overflow-hidden bg-muted/30"
	class:place-mode={view.placeMarkerMode || Boolean(view.moveMarkerId)}
	bind:this={host}
	role="application"
	aria-label="Mall basemap"
></div>

{#if view.moveMarkerId}
	<div
		class="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-md border bg-background/95 px-3 py-1.5 text-sm shadow-sm"
	>
		Click the map to move the marker · Esc to cancel
	</div>
{:else if view.placeMarkerMode}
	<div
		class="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-md border bg-background/95 px-3 py-1.5 text-sm shadow-sm"
	>
		Click the map to place a VPR marker · Esc to cancel
	</div>
{/if}

<style>
	.map-canvas :global(canvas.map-pixi-canvas) {
		width: 100%;
		height: 100%;
	}
</style>
