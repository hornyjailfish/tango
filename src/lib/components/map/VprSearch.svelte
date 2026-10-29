<script lang="ts">
	import ImageIcon from '@lucide/svelte/icons/image';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { cn } from '#lib/utils.js';
	import {
		selectMarker,
		upsertMarker,
		view,
		type Selection
	} from '#lib/state/map.svelte.js';
	import type { MarkerRecord } from '#lib/types/markers.js';

	type VprHit = {
		id: string;
		peak: number;
		score: number;
		floor: number | null;
		zoneId: string | null;
		x: number;
		y: number;
		label: string | null;
		views: { id: string; score: number }[];
	};

	type VprSearchResult = {
		target: string;
		topK: number;
		minScore: number;
		count: number;
		results: VprHit[];
	};

	const DEFAULT_MIN_SCORE = 0.35;
	const DEFAULT_TOP_K = 8;
	const TOP_K_OPTIONS = [5, 8, 12, 20, 30] as const;
	/** Service gets min_score=0 so it returns a diverse top-k; UI slider filters only. */
	const SERVICE_MIN_SCORE = 0;

	let open = $state(false);
	let dragging = $state(false);
	let loading = $state(false);
	let error = $state<string | null>(null);
	/** Full last response from the embedding service (unfiltered by UI score). */
	let rawHits = $state.raw<VprHit[]>([]);
	let previewUrl = $state<string | null>(null);
	let fileInput: HTMLInputElement | null = $state(null);
	/** Kept so top-k / floor changes can re-query without re-picking the file. */
	let lastFile: File | null = null;
	/** UI-only cutoff — does not re-call the embedding service. */
	let minScore = $state(DEFAULT_MIN_SCORE);
	let topK = $state(DEFAULT_TOP_K);
	/** When true and a floor is selected, restrict VPR to that floor; off = all floors. */
	let currentFloorOnly = $state(true);
	let dragDepth = 0;
	let windowDragDepth = 0;
	let requeryTimer: ReturnType<typeof setTimeout> | null = null;

	function hitRank(hit: VprHit): number {
		return Math.max(hit.score ?? 0, hit.peak ?? 0);
	}

	/** Client-side score filter over the last service payload. */
	const visibleHits = $derived(
		rawHits.filter((h) => hitRank(h) + 1e-9 >= minScore).sort((a, b) => hitRank(b) - hitRank(a))
	);

	function hitToMarker(hit: VprHit): MarkerRecord {
		return {
			id: hit.id,
			floor: hit.floor ?? view.floor ?? 0,
			zoneId: hit.zoneId,
			x: hit.x,
			y: hit.y,
			label: hit.label,
			createdAt: null,
			updatedAt: null,
			viewCount: hit.views.length
		};
	}

	function revokePreview(): void {
		if (previewUrl) {
			URL.revokeObjectURL(previewUrl);
			previewUrl = null;
		}
	}

	function clear(): void {
		rawHits = [];
		error = null;
		loading = false;
		lastFile = null;
		if (requeryTimer) {
			clearTimeout(requeryTimer);
			requeryTimer = null;
		}
		revokePreview();
		if (fileInput) fileInput.value = '';
	}

	function close(): void {
		open = false;
		clear();
	}

	/** Harden labels if a raw/odd payload slips past the server normalizer. */
	function normalizeHitClient(hit: VprHit): VprHit {
		const label =
			typeof hit.label === 'string' && hit.label.trim() && hit.label !== '[object Object]'
				? hit.label.trim()
				: null;
		const id = typeof hit.id === 'string' ? hit.id : String(hit.id ?? '');
		return { ...hit, id, label };
	}

	function hitTitle(hit: VprHit): string {
		if (hit.label) return hit.label;
		const id = typeof hit.id === 'string' ? hit.id : String(hit.id ?? '');
		return id ? `Marker ${id.slice(0, 8)}` : 'Marker';
	}

	async function runSearch(file: File, opts?: { keepPreview?: boolean }): Promise<void> {
		if (!file.type.startsWith('image/')) {
			error = 'Drop an image file';
			open = true;
			return;
		}

		lastFile = file;
		if (!opts?.keepPreview) {
			revokePreview();
			previewUrl = URL.createObjectURL(file);
		}
		open = true;
		loading = true;
		error = null;
		rawHits = [];

		const k = Math.min(30, Math.max(1, Math.floor(topK)));
		const floorFilter =
			currentFloorOnly && view.floor !== null ? view.floor : null;

		try {
			const body = new FormData();
			body.set('image', file);
			body.set('top_k', String(k));
			// Do not apply UI score cutoff server-side — keep results diverse for local filtering.
			body.set('min_score', String(SERVICE_MIN_SCORE));
			if (floorFilter !== null) body.set('floor', String(floorFilter));

			const res = await fetch('/api/vpr/search', { method: 'POST', body });
			if (!res.ok) {
				const text = await res.text();
				let msg = text.slice(0, 240);
				try {
					const j = JSON.parse(text) as { message?: string };
					if (j.message) msg = j.message;
				} catch {
					// keep
				}
				throw new Error(msg || `Search failed (${res.status})`);
			}
			const data = (await res.json()) as VprSearchResult;
			rawHits = (data.results ?? []).map(normalizeHitClient);
			// Auto-select best hit that passes the current UI score filter.
			const best = rawHits
				.filter((h) => hitRank(h) + 1e-9 >= minScore)
				.sort((a, b) => hitRank(b) - hitRank(a))[0];
			if (best) pick(best);
		} catch (e) {
			error = e instanceof Error ? e.message : 'VPR search failed';
			rawHits = [];
		} finally {
			loading = false;
		}
	}

	/** Re-query service only for top-k / floor (not score). */
	function scheduleRequery(): void {
		if (!lastFile) return;
		if (requeryTimer) clearTimeout(requeryTimer);
		requeryTimer = setTimeout(() => {
			requeryTimer = null;
			if (lastFile) void runSearch(lastFile, { keepPreview: true });
		}, 280);
	}

	function onMinScoreInput(value: number): void {
		minScore = Math.min(1, Math.max(0, value));
		// UI filter only — rawHits unchanged, no embedding call.
	}

	function setTopK(next: number): void {
		const k = Math.min(30, Math.max(1, Math.floor(next)));
		if (topK === k) return;
		topK = k;
		scheduleRequery();
	}

	function setCurrentFloorOnly(next: boolean): void {
		if (currentFloorOnly === next) return;
		currentFloorOnly = next;
		scheduleRequery();
	}

	function pick(hit: VprHit): void {
		const marker = hitToMarker(hit);
		upsertMarker(marker);
		selectMarker(marker, { fit: true });
	}

	function onFiles(files: FileList | null | undefined): void {
		const file = files?.[0];
		if (file) void runSearch(file);
	}

	function hasImageFile(dt: DataTransfer | null): boolean {
		if (!dt) return false;
		if (dt.types.includes('Files')) {
			for (const f of dt.files ?? []) {
				if (f.type.startsWith('image/')) return true;
			}
			// During dragenter, files may be empty — check items.
			for (const item of dt.items ?? []) {
				if (item.kind === 'file' && item.type.startsWith('image/')) return true;
			}
			// Generic file drag without MIME yet
			return dt.types.includes('Files');
		}
		return false;
	}

	function onPanelDragEnter(e: DragEvent): void {
		e.preventDefault();
		e.stopPropagation();
		dragDepth += 1;
		dragging = true;
	}

	function onPanelDragLeave(e: DragEvent): void {
		e.preventDefault();
		e.stopPropagation();
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) dragging = false;
	}

	function onPanelDragOver(e: DragEvent): void {
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
	}

	function onPanelDrop(e: DragEvent): void {
		e.preventDefault();
		e.stopPropagation();
		dragDepth = 0;
		dragging = false;
		onFiles(e.dataTransfer?.files);
	}

	function scorePct(n: number): string {
		return `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`;
	}

	function floorLabel(floor: number | null): string {
		if (floor === null) return '—';
		return String(floor);
	}

	function isSelected(id: string): boolean {
		const s: Selection | null = view.selection;
		return s?.kind === 'marker' && s.id === id;
	}

	// Window-level image drop → open VPR search (works even when panel closed).
	$effect(() => {
		if (typeof document === 'undefined') return;

		const onEnter = (e: DragEvent) => {
			if (!hasImageFile(e.dataTransfer)) return;
			e.preventDefault();
			windowDragDepth += 1;
			dragging = true;
		};
		const onLeave = (e: DragEvent) => {
			e.preventDefault();
			windowDragDepth = Math.max(0, windowDragDepth - 1);
			if (windowDragDepth === 0 && dragDepth === 0) dragging = false;
		};
		const onOver = (e: DragEvent) => {
			if (!hasImageFile(e.dataTransfer)) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
		};
		const onDrop = (e: DragEvent) => {
			windowDragDepth = 0;
			dragDepth = 0;
			dragging = false;
			if (!hasImageFile(e.dataTransfer)) return;
			e.preventDefault();
			onFiles(e.dataTransfer?.files);
		};

		window.addEventListener('dragenter', onEnter);
		window.addEventListener('dragleave', onLeave);
		window.addEventListener('dragover', onOver);
		window.addEventListener('drop', onDrop);
		return () => {
			window.removeEventListener('dragenter', onEnter);
			window.removeEventListener('dragleave', onLeave);
			window.removeEventListener('dragover', onOver);
			window.removeEventListener('drop', onDrop);
			if (requeryTimer) clearTimeout(requeryTimer);
			revokePreview();
		};
	});
</script>

<div class="relative">
	<Button
		variant="outline"
		size="sm"
		class={cn(
			'gap-1.5',
			(open || dragging) &&
				'border-[color:var(--mall-primary,var(--primary))] bg-[color:var(--mall-primary,var(--primary))]/10'
		)}
		onclick={() => {
			if (open) close();
			else open = true; // open panel (threshold + drop zone); DnD still works without this
		}}
		title="Search map by photo (VPR) — or drop an image anywhere"
		aria-expanded={open}
	>
		{#if loading}
			<LoaderCircleIcon class="size-4 animate-spin" />
			Matching…
		{:else}
			<ImageIcon class="size-4" />
			VPR
		{/if}
	</Button>

	<input
		bind:this={fileInput}
		type="file"
		accept="image/jpeg,image/png,image/webp,image/gif"
		class="hidden"
		onchange={(e) => onFiles(e.currentTarget.files)}
	/>

	{#if open}
		<div
			class={cn(
				'absolute top-[calc(100%+0.35rem)] right-0 z-50 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-[color:var(--mall-border,var(--border))] bg-[color:var(--mall-wash,var(--popover))] shadow-lg',
				dragging && 'ring-2 ring-[color:var(--mall-primary,var(--primary))]'
			)}
			role="dialog"
			tabindex="-1"
			aria-label="VPR image search"
			ondragenter={onPanelDragEnter}
			ondragleave={onPanelDragLeave}
			ondragover={onPanelDragOver}
			ondrop={onPanelDrop}
		>
			<div class="flex items-start justify-between gap-2 border-b px-3 py-2">
				<div class="min-w-0">
					<p class="text-sm font-medium">Search by photo</p>
					<p class="text-xs text-muted-foreground">Drop an image or pick a file</p>
				</div>
				<button
					type="button"
					class="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
					aria-label="Close VPR search"
					onclick={close}
				>
					<XIcon class="size-4" />
				</button>
			</div>

			<div class="space-y-2 border-b px-3 py-2">
				<div class="grid grid-cols-2 gap-2">
					<div class="space-y-1">
						<label for="vpr-top-k" class="text-xs font-medium text-muted-foreground">Top-K</label>
						<select
							id="vpr-top-k"
							class="h-8 w-full rounded-md border border-border/60 bg-background px-2 text-xs"
							value={topK}
							onchange={(e) => setTopK(Number(e.currentTarget.value))}
							disabled={loading}
							title="How many candidates the service returns (re-queries)"
						>
							{#each TOP_K_OPTIONS as k (k)}
								<option value={k}>{k}</option>
							{/each}
						</select>
					</div>
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">Floor</p>
						<div
							class="grid grid-cols-2 gap-0.5 rounded-md border border-border/60 bg-muted/40 p-0.5"
							role="group"
							aria-label="VPR floor scope"
						>
							<button
								type="button"
								class={cn(
									'rounded px-1.5 py-1 text-[11px] transition-colors',
									currentFloorOnly
										? 'bg-background font-medium text-foreground shadow-sm'
										: 'text-muted-foreground hover:text-foreground'
								)}
								onclick={() => setCurrentFloorOnly(true)}
								disabled={loading || view.floor === null}
								title={view.floor === null
									? 'Select a floor on the map first'
									: `Limit to floor ${view.floor} (re-queries)`}
							>
								{view.floor !== null ? String(view.floor) : '—'}
							</button>
							<button
								type="button"
								class={cn(
									'rounded px-1.5 py-1 text-[11px] transition-colors',
									!currentFloorOnly
										? 'bg-background font-medium text-foreground shadow-sm'
										: 'text-muted-foreground hover:text-foreground'
								)}
								onclick={() => setCurrentFloorOnly(false)}
								disabled={loading}
								title="All floors (re-queries)"
							>
								All
							</button>
						</div>
					</div>
				</div>

				<div class="space-y-1.5">
					<div class="flex items-center justify-between gap-2 text-xs">
						<label for="vpr-min-score" class="font-medium text-muted-foreground">
							Score filter
							<span class="font-normal">(UI only)</span>
						</label>
						<span class="tabular-nums text-foreground">{minScore.toFixed(2)}</span>
					</div>
					<input
						id="vpr-min-score"
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={minScore}
						class="w-full accent-[color:var(--mall-primary,var(--primary))]"
						oninput={(e) => onMinScoreInput(Number(e.currentTarget.value))}
						title="Hides weak hits locally — does not re-search"
					/>
					<div class="flex justify-between text-[10px] text-muted-foreground">
						<span>0 show all</span>
						<button
							type="button"
							class="underline-offset-2 hover:underline disabled:opacity-50"
							onclick={() => onMinScoreInput(DEFAULT_MIN_SCORE)}
							disabled={minScore === DEFAULT_MIN_SCORE}
						>
							reset {DEFAULT_MIN_SCORE.toFixed(2)}
						</button>
						<span>1 strict</span>
					</div>
					{#if rawHits.length > 0}
						<p class="text-[10px] text-muted-foreground">
							Showing {visibleHits.length} of {rawHits.length} result{rawHits.length === 1
								? ''
								: 's'}
						</p>
					{/if}
				</div>
			</div>

			<button
				type="button"
				class={cn(
					'm-3 flex min-h-28 w-[calc(100%-1.5rem)] flex-col items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-center transition-colors',
					dragging
						? 'border-[color:var(--mall-primary,var(--primary))] bg-[color:var(--mall-primary,var(--primary))]/10'
						: 'border-muted-foreground/30 bg-muted/30 hover:border-[color:var(--mall-primary,var(--primary))]/50'
				)}
				onclick={() => fileInput?.click()}
			>
				{#if previewUrl}
					<img src={previewUrl} alt="" class="max-h-24 max-w-full rounded object-contain" />
				{:else}
					<ImageIcon class="size-6 text-muted-foreground" />
					<span class="text-xs text-muted-foreground">Drop image here</span>
				{/if}
			</button>

			{#if error}
				<p class="px-3 pb-2 text-sm text-destructive">{error}</p>
			{:else if loading}
				<p class="flex items-center gap-2 px-3 pb-3 text-sm text-muted-foreground">
					<LoaderCircleIcon class="size-4 animate-spin" />
					Encoding & searching…
				</p>
			{:else if rawHits.length === 0 && previewUrl}
				<p class="px-3 pb-3 text-sm text-muted-foreground">No matching markers</p>
			{:else if visibleHits.length === 0 && rawHits.length > 0}
				<p class="px-3 pb-3 text-sm text-muted-foreground">
					All {rawHits.length} hit{rawHits.length === 1 ? '' : 's'} below score filter — lower the slider
				</p>
			{:else if visibleHits.length > 0}
				<ul class="max-h-64 overflow-y-auto border-t py-1">
					{#each visibleHits as hit (hit.id)}
						<li>
							<button
								type="button"
								class={cn(
									'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary/80',
									isSelected(hit.id) &&
										'bg-[color:var(--mall-primary,var(--primary))]/10 ring-1 ring-[color:var(--mall-primary,var(--primary))] ring-inset'
								)}
								onclick={() => pick(hit)}
							>
								<span class="min-w-0 flex-1">
									<span class="flex items-center gap-2">
										<span class="truncate font-medium">
											{hitTitle(hit)}
										</span>
										<Badge variant="secondary" class="shrink-0 text-[10px]">
											{floorLabel(hit.floor)}
										</Badge>
									</span>
									<span class="mt-0.5 block text-xs text-muted-foreground">
										score {hit.score.toFixed(3)} · peak {scorePct(hit.peak)} ·
										{hit.views.length} view{hit.views.length === 1 ? '' : 's'}
									</span>
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

{#if dragging}
	<div
		class="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-background/40 backdrop-blur-[1px]"
		aria-hidden="true"
	>
		<div
			class="rounded-xl border-2 border-dashed border-[color:var(--mall-primary,var(--primary))] bg-background/95 px-6 py-4 text-center shadow-lg"
		>
			<p class="text-sm font-medium">Drop image to VPR search</p>
			<p class="text-xs text-muted-foreground">Matches photo against marker embeddings</p>
		</div>
	</div>
{/if}
