<script lang="ts">
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { view } from '#lib/state/map.svelte.js';
	import { htmlToText, splitTags } from '#lib/map/text.js';
	import type {
		NormalizedCategory,
		NormalizedShop
	} from '#lib/tango/adapters/index.js';

	let {
		shops,
		categories
	}: {
		shops: NormalizedShop[];
		categories: NormalizedCategory[];
	} = $props();

	const shopById = $derived(new Map(shops.map((s) => [s.id, s])));
	const catById = $derived(new Map(categories.map((c) => [c.id, c])));
	const sel = $derived(view.selection);

	/** Prefer shop_cache; fall back to map selection payload. */
	const shop = $derived(sel ? (shopById.get(sel.id) ?? null) : null);
	const title = $derived(shop?.name ?? sel?.name ?? 'Selection');
	const kindLabel = $derived.by(() => {
		if (!sel) return '';
		if (shop) return 'Shop';
		if (sel.kind === 'poi' || sel.cls) {
			return `POI${sel.cls ? ` · ${sel.cls}` : ''}`;
		}
		return 'Map object';
	});

	const floor = $derived(shop?.floor ?? sel?.floor ?? null);
	const room = $derived(shop?.roomNumber ?? sel?.roomNumber ?? null);
	const logo = $derived(shop?.logo ?? sel?.logo ?? null);
	const color = $derived(shop?.color ?? sel?.color ?? null);
	const catIds = $derived(shop?.categories ?? sel?.categories ?? []);
	const shortText = $derived(
		htmlToText(shop?.shortDescription ?? sel?.shortDescription)
	);
	const longText = $derived(htmlToText(shop?.description ?? sel?.description));
	const tags = $derived(splitTags(shop?.searchTags ?? null));

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
	<Sheet.Content
		side="right"
		showOverlay={false}
		class="flex w-[400px] flex-col gap-0 sm:max-w-[440px]"
	>
		<Sheet.Header class="border-b pb-4">
			<div class="flex items-start gap-3">
				{#if logo}
					<img
						src={logo}
						alt=""
						class="size-14 shrink-0 rounded-md border bg-background object-contain p-1"
					/>
				{:else if color}
					<span
						class="size-14 shrink-0 rounded-md border"
						style:background={color}
						aria-hidden="true"
					></span>
				{/if}
				<div class="min-w-0 flex-1">
					<Sheet.Title class="text-left leading-tight">{title}</Sheet.Title>
					<Sheet.Description class="text-left">{kindLabel}</Sheet.Description>
				</div>
			</div>
		</Sheet.Header>

		{#if sel}
			<div class="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
				<div class="flex flex-wrap gap-2">
					{#if floor !== null}
						<Badge variant="secondary">Floor {floor}</Badge>
					{/if}
					{#if room}
						<Badge variant="outline">Room {room}</Badge>
					{/if}
					{#if shop}
						<Badge variant={shop.isActive ? 'default' : 'destructive'}>
							{shop.isActive ? 'Active' : 'Inactive'}
						</Badge>
					{/if}
					{#if sel.cls && !shop}
						<Badge variant="outline">{sel.cls}</Badge>
					{/if}
				</div>

				{#if catIds.length}
					<div class="space-y-1.5">
						<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							Categories
						</p>
						<div class="flex flex-wrap gap-1.5">
							{#each catIds as catId (catId)}
								{@const cat = catById.get(catId)}
								<Badge variant="outline">{cat?.name ?? catId}</Badge>
							{/each}
						</div>
					</div>
				{/if}

				{#if shortText || longText}
					<Separator />
					<div class="space-y-2">
						<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							About
						</p>
						{#if shortText}
							<p class="text-sm leading-relaxed">{shortText}</p>
						{/if}
						{#if longText && longText !== shortText}
							<p class="text-sm leading-relaxed text-muted-foreground">{longText}</p>
						{/if}
					</div>
				{/if}

				{#if tags.length}
					<Separator />
					<div class="space-y-1.5">
						<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							Search tags
						</p>
						<div class="flex flex-wrap gap-1.5">
							{#each tags as tag, i (i)}
								<Badge variant="secondary" class="font-normal">{tag}</Badge>
							{/each}
						</div>
					</div>
				{/if}

				<Separator />
				<div class="space-y-1 text-xs text-muted-foreground">
					<p>
						<span class="font-medium text-foreground">ID</span>
						<span class="ml-2 font-mono break-all">{sel.id}</span>
					</p>
					{#if shop?.updatedAt}
						<p>Updated {new Date(shop.updatedAt).toLocaleString()}</p>
					{/if}
					{#if !shop}
						<p class="text-amber-600 dark:text-amber-400">
							Not in shop cache — showing map object only.
						</p>
					{/if}
				</div>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
