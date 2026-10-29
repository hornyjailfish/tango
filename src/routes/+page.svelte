<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import MapCanvas from '#lib/components/map/MapCanvas.svelte';
	import LayerSwitch from '#lib/components/map/LayerSwitch.svelte';
	import FloorSwitcher from '#lib/components/map/FloorSwitcher.svelte';
	import SelectionPanel from '#lib/components/map/SelectionPanel.svelte';
	import MarkerPanel from '#lib/components/map/MarkerPanel.svelte';
	import MarkerToolbar from '#lib/components/map/MarkerToolbar.svelte';
	import ShopSearch from '#lib/components/map/ShopSearch.svelte';
	import VprSearch from '#lib/components/map/VprSearch.svelte';
	import { view } from '#lib/state/map.svelte.js';
	import {
		themeToCssVars,
		type NormalizedFloor
	} from '#lib/tango/adapters/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let meta = $state(data.meta);
	let floorData = $state<NormalizedFloor | null>(null);
	let loadingFloor = $state(false);
	let syncing = $state(false);

	const highlightColor = $derived(meta.mall?.theme?.highlight ?? '#f9c416');

	// Apply Tango mall.theme → CSS vars (brand primary, surfaces, highlight)
	$effect(() => {
		const theme = meta.mall?.theme;
		if (!theme || typeof document === 'undefined') return;
		const root = document.documentElement;
		const vars = themeToCssVars(theme);
		for (const [key, value] of Object.entries(vars)) {
			root.style.setProperty(key, value);
		}
		return () => {
			for (const key of Object.keys(vars)) root.style.removeProperty(key);
		};
	});

	// initial floor: mall default (if present in cache) → first cached floor
	if (view.floor === null) {
		const preferred = meta.mall?.defaultFloorNumber ?? null;
		const hasPreferred =
			preferred !== null && meta.floors.some((f) => f.number === preferred);
		view.floor = hasPreferred ? preferred : (meta.floors[0]?.number ?? null);
	}

	$effect(() => {
		const n = view.floor;
		if (n === null) return;
		loadingFloor = true;
		fetch(`/api/basemap/floor/${n}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((d: NormalizedFloor | null) => {
				if (view.floor === n) {
					floorData = d;
					loadingFloor = false;
				}
			})
			.catch(() => {
				if (view.floor === n) loadingFloor = false;
			});
	});

	async function sync(): Promise<void> {
		syncing = true;
		try {
			const res = await fetch('/api/sync', { method: 'POST' });
			if (res.ok) {
				const outcome = await res.json();
				meta.revision = outcome.revision;
			}
		} finally {
			syncing = false;
		}
	}

	const statusVariant = $derived(
		meta.revision.syncStatus === 'error'
			? 'destructive'
			: meta.revision.syncStatus === 'stale'
				? 'secondary'
				: 'green'
	);
</script>

<svelte:head><title>Vision — basemap</title></svelte:head>

<div class="flex h-dvh flex-col gap-3 p-3">
	<header class="flex flex-wrap items-center gap-3">
		<h1 class="text-lg font-semibold text-[color:var(--mall-ink,var(--foreground))]">
			Tango Vision · EE basemap
		</h1>
		<Badge variant={statusVariant}>sync: {meta.revision.syncStatus}</Badge>
		{#if meta.revision.fetchedAt}
			<span class="text-xs text-muted-foreground">
				last synced {new Date(meta.revision.fetchedAt).toLocaleString()}
			</span>
		{/if}
		<div class="ml-auto flex flex-wrap items-center gap-3">
			<ShopSearch />
			<VprSearch />
			<MarkerToolbar />
			<FloorSwitcher floors={meta.floors} />
			<LayerSwitch />
			<Button
				variant="outline"
				class="border-[color:var(--mall-primary,var(--primary))] bg-[color:var(--mall-primary,var(--primary))] text-[color:var(--mall-on-primary,var(--primary-foreground))] hover:bg-[color:var(--mall-primary-deep,var(--primary))]"
				onclick={sync}
				disabled={syncing}
			>
				{syncing ? 'Syncing…' : 'Sync'}
			</Button>
		</div>
	</header>

	{#if meta.revision.syncStatus === 'error'}
		<Alert variant="destructive">
			<p class="font-medium">
				Basemap sync failed — using map from
				{meta.revision.fetchedAt ? new Date(meta.revision.fetchedAt).toLocaleString() : 'cache'}.
			</p>
			{#if meta.revision.lastError}
				<p class="text-sm">
					{meta.revision.lastError.path}: {meta.revision.lastError.message}
				</p>
			{/if}
		</Alert>
	{:else if meta.revision.syncStatus === 'stale'}
		<Alert>
			<p class="text-sm">
				Basemap is stale — last synced
				{meta.revision.fetchedAt ? new Date(meta.revision.fetchedAt).toLocaleString() : 'unknown'}.
			</p>
		</Alert>
	{/if}

	<main class="relative min-h-0 flex-1 overflow-hidden rounded-lg border">
		{#if meta.floors.length === 0}
			<div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
				<p class="text-lg font-medium">No basemap cached</p>
				<p class="max-w-md text-sm text-muted-foreground">
					Cache is empty. Sync pulls floors from Tango API into Surreal. If the API is unreachable,
					the app stays offline-safe and shows this error instead of crashing.
				</p>
				{#if meta.revision.lastError}
					<p class="max-w-md text-sm text-destructive">
						{meta.revision.lastError.path}: {meta.revision.lastError.message}
					</p>
				{/if}
				<Button onclick={sync} disabled={syncing}>
					{syncing ? 'Syncing…' : 'Retry sync'}
				</Button>
			</div>
		{:else if loadingFloor || !floorData}
			<div class="flex h-full flex-col gap-2 p-6">
				<Skeleton class="size-full" />
			</div>
		{:else}
			<MapCanvas {floorData} shops={meta.shops} {highlightColor} />
		{/if}
	</main>
</div>

<SelectionPanel shops={meta.shops} categories={meta.categories} />
<MarkerPanel />
