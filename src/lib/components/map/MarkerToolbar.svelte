<script lang="ts">
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import CrosshairIcon from '@lucide/svelte/icons/crosshair';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { layers, togglePlaceMarkerMode, view } from '#lib/state/map.svelte.js';
	import { cn } from '#lib/utils.js';

	const count = $derived(view.markers.length);
</script>

<div class="flex items-center gap-2">
	<Button
		variant={view.placeMarkerMode ? 'default' : 'outline'}
		size="sm"
		class={cn(
			view.placeMarkerMode &&
				'bg-[color:var(--mall-primary,var(--primary))] text-[color:var(--mall-on-primary,var(--primary-foreground))]'
		)}
		onclick={() => {
			layers.markers = true;
			togglePlaceMarkerMode();
		}}
		aria-pressed={view.placeMarkerMode}
		title={view.placeMarkerMode ? 'Click map to place — Esc to cancel' : 'Place VPR marker'}
	>
		{#if view.placeMarkerMode}
			<CrosshairIcon class="size-4" />
			Click map…
		{:else}
			<MapPinIcon class="size-4" />
			Place marker
		{/if}
	</Button>
	{#if count > 0}
		<Badge variant="secondary" class="font-normal">
			{count} marker{count === 1 ? '' : 's'}
		</Badge>
	{/if}
</div>
