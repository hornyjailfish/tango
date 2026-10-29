<script lang="ts">
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import { layers, type LayerKey } from '#lib/state/map.svelte.js';

	const LABELS: Record<LayerKey, string> = {
		walls: 'Walls',
		tenants: 'Tenants',
		poi: 'POI',
		walk: 'Walk',
		markers: 'Markers'
	};

	let value = $state(
		(Object.keys(LABELS) as LayerKey[]).filter((k) => layers[k] && k !== 'walk')
	);

	$effect(() => {
		for (const key of Object.keys(LABELS) as LayerKey[]) {
			layers[key] = value.includes(key);
		}
	});
</script>

<ToggleGroup.Root type="multiple" bind:value variant="outline" aria-label="Map layers">
	{#each Object.entries(LABELS) as [key, label] (key)}
		<ToggleGroup.Item value={key}>{label}</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>
