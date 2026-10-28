<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import XIcon from '@lucide/svelte/icons/x';
	import { Input } from '#lib/components/ui/input/index.js';
	import { searchShops, type ShopSearchHit } from '#lib/shop-search.remote.js';
	import { selectShop } from '#lib/state/map.svelte.js';
	import { splitTags } from '#lib/map/text.js';
	import { cn } from '#lib/utils.js';

	let q = $state('');
	let open = $state(false);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let hits = $state.raw<ShopSearchHit[]>([]);
	let activeIndex = $state(-1);
	let rootEl: HTMLDivElement | undefined = $state();
	let inputEl: HTMLInputElement | null = $state(null);

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let requestGen = 0;

	function clearDebounce(): void {
		if (debounceTimer !== null) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
	}

	function resetResults(): void {
		hits = [];
		activeIndex = -1;
		error = null;
		loading = false;
	}

	async function runSearch(term: string): Promise<void> {
		const trimmed = term.trim();
		if (trimmed.length < 1) {
			resetResults();
			return;
		}

		const gen = ++requestGen;
		loading = true;
		error = null;
		open = true;

		try {
			const result = await searchShops({ q: trimmed, limit: 12 });
			if (gen !== requestGen) return;
			hits = result;
			activeIndex = result.length > 0 ? 0 : -1;
		} catch (e) {
			if (gen !== requestGen) return;
			hits = [];
			activeIndex = -1;
			error = e instanceof Error ? e.message : 'Search failed';
		} finally {
			if (gen === requestGen) loading = false;
		}
	}

	function onInput(value: string): void {
		q = value;
		clearDebounce();
		const trimmed = value.trim();
		if (trimmed.length < 1) {
			requestGen += 1;
			resetResults();
			open = false;
			return;
		}
		open = true;
		loading = true;
		debounceTimer = setTimeout(() => {
			void runSearch(trimmed);
		}, 220);
	}

	function pick(hit: ShopSearchHit): void {
		selectShop({
			id: hit.id,
			name: hit.name,
			floor: hit.floor,
			categories: hit.categories,
			description: hit.description,
			shortDescription: hit.shortDescription,
			logo: hit.logo,
			color: hit.color,
			roomNumber: hit.roomNumber
		});
		q = hit.name;
		open = false;
		hits = [];
		activeIndex = -1;
		inputEl?.blur();
	}

	function onKeydown(e: KeyboardEvent): void {
		if (!open) {
			if (e.key === 'ArrowDown' && q.trim()) {
				open = true;
				void runSearch(q);
			}
			return;
		}

		if (e.key === 'Escape') {
			e.preventDefault();
			open = false;
			activeIndex = -1;
			return;
		}

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (hits.length === 0) return;
			activeIndex = (activeIndex + 1) % hits.length;
			return;
		}

		if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (hits.length === 0) return;
			activeIndex = activeIndex <= 0 ? hits.length - 1 : activeIndex - 1;
			return;
		}

		if (e.key === 'Enter' && activeIndex >= 0 && hits[activeIndex]) {
			e.preventDefault();
			pick(hits[activeIndex]);
		}
	}

	function onDocPointerDown(e: PointerEvent): void {
		if (!open || !rootEl) return;
		const t = e.target;
		if (t instanceof Node && rootEl.contains(t)) return;
		open = false;
	}

	$effect(() => {
		if (typeof document === 'undefined') return;
		document.addEventListener('pointerdown', onDocPointerDown);
		return () => {
			document.removeEventListener('pointerdown', onDocPointerDown);
			clearDebounce();
		};
	});

	function floorLabel(floor: number | null): string {
		if (floor === null) return '—';
		return `F${floor}`;
	}
</script>

<div class="shop-search relative w-full max-w-sm min-w-[14rem]" bind:this={rootEl}>
	<div
		class="flex h-9 items-center gap-2 rounded-lg border border-[color:var(--mall-border,var(--border))] bg-[color:var(--mall-wash,var(--background))] px-2.5 shadow-sm transition-shadow focus-within:border-[color:var(--mall-primary,var(--primary))] focus-within:ring-3 focus-within:ring-[color:var(--mall-primary,var(--primary))]/25"
	>
		{#if loading}
			<LoaderCircleIcon
				class="size-4 shrink-0 animate-spin text-[color:var(--mall-primary,var(--primary))]"
				aria-hidden="true"
			/>
		{:else}
			<SearchIcon
				class="size-4 shrink-0 text-[color:var(--mall-primary,var(--primary))]"
				aria-hidden="true"
			/>
		{/if}
		<Input
			bind:ref={inputEl}
			type="search"
			autocomplete="off"
			autocorrect="off"
			spellcheck={false}
			placeholder="Search shops…"
			aria-label="Search shops"
			aria-autocomplete="list"
			aria-expanded={open}
			aria-controls="shop-search-results"
			class="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:border-0 focus-visible:ring-0"
			bind:value={q}
			oninput={(e) => onInput(e.currentTarget.value)}
			onkeydown={onKeydown}
			onfocus={() => {
				if (q.trim() && (hits.length > 0 || error)) open = true;
			}}
		/>
		{#if q}
			<button
				type="button"
				class="rounded p-0.5 text-muted-foreground hover:bg-[color:var(--mall-surface,var(--secondary))] hover:text-foreground"
				aria-label="Clear search"
				onclick={() => {
					q = '';
					requestGen += 1;
					resetResults();
					open = false;
					inputEl?.focus();
				}}
			>
				<XIcon class="size-3.5" />
			</button>
		{/if}
	</div>

	{#if open}
		<div
			id="shop-search-results"
			role="listbox"
			class="absolute top-[calc(100%+0.35rem)] right-0 left-0 z-50 overflow-hidden rounded-lg border border-[color:var(--mall-border,var(--border))] bg-[color:var(--mall-wash,var(--popover))] shadow-lg"
		>
			{#if error}
				<p class="px-3 py-2.5 text-sm text-destructive">{error}</p>
			{:else if loading && hits.length === 0}
				<p class="px-3 py-2.5 text-sm text-muted-foreground">Searching…</p>
			{:else if hits.length === 0}
				<p class="px-3 py-2.5 text-sm text-muted-foreground">No shops found</p>
			{:else}
				<ul class="max-h-72 overflow-y-auto py-1">
					{#each hits as hit, i (hit.id)}
						{@const tags = splitTags(hit.searchTags).slice(0, 3)}
						<li role="option" aria-selected={i === activeIndex}>
							<button
								type="button"
								class={cn(
									'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-[color:var(--mall-surface,var(--secondary))]',
									i === activeIndex &&
										'bg-[color:var(--mall-surface,var(--secondary))] ring-1 ring-[color:var(--mall-primary,var(--primary))] ring-inset'
								)}
								onmouseenter={() => (activeIndex = i)}
								onclick={() => pick(hit)}
							>
								{#if hit.logo}
									<img
										src={hit.logo}
										alt=""
										class="mt-0.5 size-8 shrink-0 rounded border bg-background object-contain p-0.5"
									/>
								{:else if hit.color}
									<span
										class="mt-0.5 size-8 shrink-0 rounded border"
										style:background={hit.color}
										aria-hidden="true"
									></span>
								{:else}
									<span
										class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded border bg-[color:var(--mall-surface,var(--secondary))] text-xs font-semibold text-[color:var(--mall-primary,var(--primary))]"
										aria-hidden="true"
									>
										{hit.name.slice(0, 1).toUpperCase()}
									</span>
								{/if}
								<span class="min-w-0 flex-1">
									<span class="flex items-center gap-2">
										<span class="truncate text-sm font-medium text-foreground">{hit.name}</span>
										<span
											class="shrink-0 rounded-full bg-[color:var(--mall-primary,var(--primary))]/12 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[color:var(--mall-primary,var(--primary))] uppercase"
										>
											{floorLabel(hit.floor)}
										</span>
									</span>
									{#if hit.roomNumber}
										<span class="mt-0.5 block truncate text-xs text-muted-foreground">
											Room {hit.roomNumber}
										</span>
									{/if}
									{#if tags.length}
										<span class="mt-1 flex flex-wrap gap-1">
											{#each tags as tag (tag)}
												<span
													class="rounded bg-[color:var(--mall-highlight,#f9c416)]/20 px-1.5 py-0.5 text-[10px] text-foreground"
												>
													{tag}
												</span>
											{/each}
										</span>
									{/if}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>
