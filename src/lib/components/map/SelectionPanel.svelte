<script lang="ts">
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { view } from '#lib/state/map.svelte.js';
	import type { NormalizedCategory } from '#lib/tango/adapters/index.js';

	let { categories }: { categories: NormalizedCategory[] } = $props();

	const nameById = new Map(categories.map((c) => [c.id, c.name]));
	const sel = $derived(view.selection);
	let open = $state(false);

	$effect(() => {
		open = sel !== null;
	});
</script>

<Sheet.Root
	bind:open
	onOpenChange={(v) => {
		if (!v) view.selection = null;
	}}
>
	<Sheet.Content side="right" class="flex w-[380px] flex-col gap-4 sm:max-w-[420px]">
		<Sheet.Header>
			<Sheet.Title>{sel?.name ?? 'Selection'}</Sheet.Title>
			<Sheet.Description>
				{sel?.kind === 'shop' ? 'Shop / POI' : `Map object${sel?.cls ? ` · ${sel.cls}` : ''}`}
			</Sheet.Description>
		</Sheet.Header>

		{#if sel}
			<div class="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
				{#if sel.logo}
					<img src={sel.logo} alt={sel.name} class="h-16 w-auto self-start rounded-md border" />
				{/if}

				<div class="flex flex-wrap gap-2">
					{#if sel.floor !== null}
						<Badge variant="secondary">Floor {sel.floor}</Badge>
					{/if}
					{#if sel.roomNumber}
						<Badge variant="outline">Room {sel.roomNumber}</Badge>
					{/if}
					{#each sel.categories as catId (catId)}
						<Badge variant="outline">{nameById.get(catId) ?? catId}</Badge>
					{/each}
				</div>

				{#if sel.shortDescription || sel.description}
					<Separator />
					<p class="text-sm text-muted-foreground">
						{sel.shortDescription ?? sel.description}
					</p>
				{/if}

				{#if sel.color}
					<div class="flex items-center gap-2">
						<span class="size-4 rounded-full border" style:background={sel.color}></span>
						<span class="text-xs text-muted-foreground">{sel.color}</span>
					</div>
				{/if}
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>