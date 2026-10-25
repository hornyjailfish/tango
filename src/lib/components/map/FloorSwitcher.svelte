<script lang="ts">
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import { view } from '#lib/state/map.svelte.js';

	let { floors }: { floors: { number: number }[] } = $props();

	const sorted = $derived([...floors].sort((a, b) => a.number - b.number));
</script>

<ToggleGroup.Root
	type="single"
	value={view.floor === null ? undefined : String(view.floor)}
	onValueChange={(v) => {
		if (v) view.floor = Number(v);
	}}
	variant="outline"
	aria-label="Floor"
>
	{#each sorted as floor (floor.number)}
		<ToggleGroup.Item value={String(floor.number)}>{floor.number}</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>