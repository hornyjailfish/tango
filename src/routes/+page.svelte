<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import MapCanvas from '#lib/components/map/MapCanvas.svelte';
	import LayerSwitch from '#lib/components/map/LayerSwitch.svelte';
	import FloorSwitcher from '#lib/components/map/FloorSwitcher.svelte';
	import SelectionPanel from '#lib/components/map/SelectionPanel.svelte';
	import { view } from '#lib/state/map.svelte.js';
	import type { NormalizedFloor } from '#lib/tango/adapters/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let meta = $state(data.meta);
	let floorData = $state<NormalizedFloor | null>(null);
	let loadingFloor = $state(false);
	let syncing = $state(false);

	// initial floor: mall default → first cached floor
	if (view.floor === null) {
		view.floor = meta.mall?.defaultFloorNumber ?? meta.floors[0]?.number ?? null;
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
				: 'outline'
	);
</script>

<svelte:head><title>Vision — basemap</title></svelte:head>

<div class="flex h-dvh flex-col gap-3 p-3">
	<header class="flex flex-wrap items-center gap-3">
		<h1 class="text-lg font-semibold">Tango Vision · EE basemap</h1>
		<Badge variant={statusVariant}>sync: {meta.revision.syncStatus}</Badge>
		{#if meta.revision.fetchedAt}
			<span class="text-xs text-muted-foreground">
				last synced {new Date(meta.revision.fetchedAt).toLocaleString()}
			</span>
		{/if}
		<div class="ml-auto flex items-center gap-3">
			<FloorSwitcher floors={meta.floors} />
			<LayerSwitch />
			<Button variant="outline" onclick={sync} disabled={syncing}>
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
			<div class="flex h-full flex-col items-center justify-center gap-2">
				<p class="text-lg font-medium">No basemap — sync failed</p>
				{#if meta.revision.lastError}
					<p class="text-sm text-muted-foreground">{meta.revision.lastError.message}</p>
				{/if}
				<Button onclick={sync} disabled={syncing}>Retry sync</Button>
			</div>
		{:else if loadingFloor || !floorData}
			<div class="flex h-full flex-col gap-2 p-6">
				<Skeleton class="size-full" />
			</div>
		{:else}
			<MapCanvas {floorData} shops={meta.shops} />
		{/if}
	</main>
</div>

<SelectionPanel categories={meta.categories} />