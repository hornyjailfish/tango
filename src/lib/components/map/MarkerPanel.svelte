<script lang="ts">
	import { untrack } from 'svelte';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import MoveIcon from '@lucide/svelte/icons/move';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import {
		listMarkerViews,
		listMarkers,
		patchMarker,
		removeMarker,
		removeMarkerView,
		type MarkerRecord,
		type MarkerViewRecord
	} from '#lib/markers.remote.js';
	import type { EmbeddingQueueStatus } from '#lib/types/markers.js';
	import { cn } from '#lib/utils.js';
	import {
		cancelMoveMarker,
		removeMarkerLocal,
		select,
		selectMarker,
		setMarkers,
		startMoveMarker,
		upsertMarker,
		view
	} from '#lib/state/map.svelte.js';

	const QUEUE_RING: Record<EmbeddingQueueStatus, string> = {
		pending: 'ring-2 ring-zinc-400',
		processing: 'ring-2 ring-dashed ring-sky-500 animate-pulse',
		failed: 'ring-2 ring-red-500',
		done: 'ring-2 ring-emerald-500'
	};

	function queueRingClass(status: EmbeddingQueueStatus | null | undefined, isTemp: boolean): string {
		if (isTemp) return QUEUE_RING.pending;
		return QUEUE_RING[status ?? 'pending'];
	}

	function queueLabel(status: EmbeddingQueueStatus | null | undefined, isTemp: boolean): string {
		if (isTemp) return 'uploading';
		switch (status) {
			case 'processing':
				return 'processing';
			case 'failed':
				return 'failed';
			case 'done':
				return 'embedded';
			case 'pending':
			default:
				return 'pending';
		}
	}

	function needsQueuePoll(list: MarkerViewRecord[]): boolean {
		return list.some((v) => {
			if (v.id.startsWith('temp-')) return true;
			const s = v.queueStatus;
			return s == null || s === 'pending' || s === 'processing';
		});
	}

	/** Stable id only — viewCount/label bumps must not re-fetch views. */
	const markerId = $derived(view.selection?.kind === 'marker' ? view.selection.id : null);
	const sel = $derived(view.selection?.kind === 'marker' ? view.selection : null);

	let open = $state(false);
	let views = $state.raw<MarkerViewRecord[]>([]);
	let loadingViews = $state(false);
	let uploading = $state(false);
	/** Completed uploads in the current batch (success or fail). */
	let uploadDone = $state(0);
	let uploadTotal = $state(0);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let labelDraft = $state('');
	let fileInput: HTMLInputElement | null = $state(null);
	/** Non-reactive: object URLs must not be effect dependencies. */
	let previewUrls: string[] = [];

	/** Parallel POSTs per batch — keep modest to avoid saturating the API. */
	const UPLOAD_CONCURRENCY = 3;

	function revokePreviews(): void {
		for (const u of previewUrls) URL.revokeObjectURL(u);
		previewUrls = [];
	}

	// Guarded write — bare `open = …` every run loops with Sheet bind:open.
	$effect(() => {
		const shouldOpen = markerId !== null;
		if (open !== shouldOpen) open = shouldOpen;
	});

	// Sync label draft when the selected marker identity/label changes.
	$effect(() => {
		const id = markerId;
		const label = sel?.label ?? '';
		if (id) labelDraft = label;
	});

	$effect(() => {
		const id = markerId;
		if (!id) {
			views = [];
			revokePreviews();
			return;
		}
		let cancelled = false;
		loadingViews = true;
		error = null;
		// untrack: remote query() is reactive; refresh() must not re-enter this effect.
		void untrack(() => {
			const q = listMarkerViews({ id });
			return q
				.refresh()
				.then(() => q)
				.then((list) => {
					if (cancelled) return;
					revokePreviews();
					views = list;
				})
				.catch((e) => {
					if (!cancelled) error = e instanceof Error ? e.message : 'Failed to load views';
				})
				.finally(() => {
					if (!cancelled) loadingViews = false;
				});
		});
		return () => {
			cancelled = true;
		};
	});

	// Poll queue status while any view is still pending/processing.
	$effect(() => {
		const id = markerId;
		const list = views;
		if (!id || !needsQueuePoll(list)) return;

		const handle = setInterval(() => {
			void untrack(async () => {
				try {
					const q = listMarkerViews({ id });
					await q.refresh();
					const next = await q;
					// Preserve optimistic temp rows while upload is in flight.
					const temps = views.filter((v) => v.id.startsWith('temp-'));
					views = temps.length ? [...next, ...temps] : next;
				} catch {
					// keep last good snapshot
				}
			});
		}, 2000);

		return () => clearInterval(handle);
	});

	async function refreshFloorMarkers(): Promise<MarkerRecord[] | null> {
		const floor = view.floor;
		const id = markerId;
		if (floor === null) return null;
		const q = listMarkers({ floor });
		await q.refresh();
		const list = await q;
		setMarkers(list);
		const still = list.find((m) => m.id === id);
		if (still) selectMarker(still, { fit: false });
		else if (id) select(null);
		return list;
	}

	function bumpLocalViewCount(delta: number): void {
		const id = markerId;
		if (!id) return;
		const cur = view.markers.find((m) => m.id === id);
		if (!cur) return;
		upsertMarker({ ...cur, viewCount: Math.max(0, cur.viewCount + delta) });
	}

	async function saveLabel(): Promise<void> {
		if (!sel) return;
		saving = true;
		error = null;
		try {
			const updated = await patchMarker({ id: sel.id, label: labelDraft.trim() || null });
			if (updated) upsertMarker(updated);
			else await refreshFloorMarkers();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Save failed';
		} finally {
			saving = false;
		}
	}

	function revokePreview(preview: string): void {
		URL.revokeObjectURL(preview);
		previewUrls = previewUrls.filter((u) => u !== preview);
	}

	async function uploadOneView(
		markerKey: string,
		file: File,
		tempId: string,
		preview: string
	): Promise<string | null> {
		try {
			const body = new FormData();
			body.set('image', file);
			const res = await fetch(`/api/markers/${encodeURIComponent(markerKey)}/views`, {
				method: 'POST',
				body
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text.slice(0, 200) || `Upload failed (${res.status})`);
			}
			const created = (await res.json()) as MarkerViewRecord;
			views = views.map((v) =>
				v.id === tempId
					? {
							...created,
							queueStatus: created.queueStatus ?? 'pending',
							queueError: created.queueError ?? null
						}
					: v
			);
			revokePreview(preview);
			return null;
		} catch (e) {
			views = views.filter((v) => v.id !== tempId);
			revokePreview(preview);
			bumpLocalViewCount(-1);
			return e instanceof Error ? e.message : 'Upload failed';
		}
	}

	async function onUpload(files: FileList | null): Promise<void> {
		if (!sel || !files?.length) return;
		const markerKey = sel.id;
		const fileList = Array.from(files);
		uploading = true;
		uploadDone = 0;
		uploadTotal = fileList.length;
		error = null;

		const jobs = fileList.map((file) => {
			const preview = URL.createObjectURL(file);
			previewUrls.push(preview);
			const tempId = `temp-${crypto.randomUUID()}`;
			const optimistic: MarkerViewRecord = {
				id: tempId,
				markerId: markerKey,
				imageKey: null,
				imageUrl: preview,
				contentType: file.type || 'image/jpeg',
				imageHash: null,
				createdAt: new Date().toISOString(),
				queueStatus: 'pending',
				queueError: null
			};
			return { file, preview, tempId, optimistic };
		});

		views = [...views, ...jobs.map((j) => j.optimistic)];
		bumpLocalViewCount(jobs.length);

		const failures: string[] = [];
		let next = 0;
		const workers = Array.from(
			{ length: Math.min(UPLOAD_CONCURRENCY, jobs.length) },
			async () => {
				while (next < jobs.length) {
					const job = jobs[next++]!;
					const errMsg = await uploadOneView(markerKey, job.file, job.tempId, job.preview);
					if (errMsg) failures.push(`${job.file.name}: ${errMsg}`);
					uploadDone += 1;
				}
			}
		);
		await Promise.all(workers);

		const settled = views.filter((v) => !v.id.startsWith('temp-'));
		listMarkerViews({ id: markerKey }).set(settled);
		void refreshFloorMarkers();

		if (failures.length === jobs.length) {
			error = failures.length === 1 ? failures[0]! : `${failures.length} uploads failed`;
		} else if (failures.length > 0) {
			error = `${failures.length} of ${jobs.length} uploads failed — ${failures[0]}`;
		}

		uploading = false;
		uploadDone = 0;
		uploadTotal = 0;
		if (fileInput) fileInput.value = '';
	}

	async function onDeleteView(viewId: string): Promise<void> {
		if (!sel) return;
		const markerKey = sel.id;
		error = null;
		const prev = views;
		views = views.filter((v) => v.id !== viewId);
		bumpLocalViewCount(-1);
		try {
			await removeMarkerView({ id: viewId });
			listMarkerViews({ id: markerKey }).set(views);
			void refreshFloorMarkers();
		} catch (e) {
			views = prev;
			bumpLocalViewCount(1);
			error = e instanceof Error ? e.message : 'Delete view failed';
		}
	}

	async function onDeleteMarker(): Promise<void> {
		if (!sel) return;
		if (!confirm('Delete this marker and all its views?')) return;
		error = null;
		const id = sel.id;
		cancelMoveMarker();
		removeMarkerLocal(id);
		try {
			await removeMarker({ id });
			void refreshFloorMarkers();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Delete failed';
			void refreshFloorMarkers();
		}
	}

	const movingThis = $derived(sel !== null && view.moveMarkerId === sel.id);

	function onToggleMove(): void {
		if (!sel) return;
		if (movingThis) cancelMoveMarker();
		else startMoveMarker(sel.id);
	}
</script>

<Sheet.Root
	bind:open
	onOpenChange={(v) => {
		if (!v && view.selection?.kind === 'marker') select(null);
	}}
>
	<!--
		Map stays interactive while the panel is open:
		- ignore outside clicks (default "close" was deselecting before move could land)
		- no body scroll lock / focus trap over the canvas
	-->
	<Sheet.Content
		side="right"
		showOverlay={false}
		interactOutsideBehavior="ignore"
		preventScroll={false}
		trapFocus={false}
		onEscapeKeydown={(e) => {
			// Esc while moving: exit move mode only (keep the panel).
			if (view.moveMarkerId) {
				e.preventDefault();
				cancelMoveMarker();
			}
		}}
		class="flex w-[400px] flex-col gap-0 sm:max-w-[440px]"
	>
		<Sheet.Header class="border-b pb-4">
			<div class="flex items-start gap-3">
				<span
					class="flex size-14 shrink-0 items-center justify-center rounded-md border bg-blue-600 text-white"
					aria-hidden="true"
				>
					<CameraIcon class="size-6" />
				</span>
				<div class="min-w-0 flex-1">
					<Sheet.Title class="text-left leading-tight">
						{sel?.name ?? 'VPR marker'}
					</Sheet.Title>
					<Sheet.Description class="text-left">Visual place marker</Sheet.Description>
				</div>
			</div>
		</Sheet.Header>

		{#if sel}
			<div class="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
				<div class="flex flex-wrap gap-2">
					{#if sel.floor !== null}
						<Badge variant="secondary">Floor {sel.floor}</Badge>
					{/if}
					<Badge variant="outline">{sel.viewCount} view{sel.viewCount === 1 ? '' : 's'}</Badge>
				</div>

				<div class="space-y-2">
					<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Label</p>
					<div class="flex gap-2">
						<Input
							bind:value={labelDraft}
							placeholder="Optional label"
							onkeydown={(e) => {
								if (e.key === 'Enter') void saveLabel();
							}}
						/>
						<Button variant="outline" onclick={() => void saveLabel()} disabled={saving}>
							{saving ? '…' : 'Save'}
						</Button>
					</div>
				</div>

				<div class="space-y-1 text-xs text-muted-foreground">
					<p>
						<span class="font-medium text-foreground">Position</span>
						<span class="ml-2 font-mono">{sel.x.toFixed(1)}, {sel.y.toFixed(1)}</span>
					</p>
					<p>
						<span class="font-medium text-foreground">ID</span>
						<span class="ml-2 font-mono break-all">{sel.id}</span>
					</p>
				</div>

				<Separator />

				<div class="space-y-3">
					<div class="flex items-center justify-between gap-2">
						<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							Views
						</p>
						<Button
							size="sm"
							variant="outline"
							disabled={uploading}
							onclick={() => fileInput?.click()}
							title="Add one or more photos"
						>
							{#if uploading}
								<LoaderCircleIcon class="size-4 animate-spin" />
								{#if uploadTotal > 1}
									{uploadDone}/{uploadTotal}…
								{:else}
									Uploading…
								{/if}
							{:else}
								<CameraIcon class="size-4" />
								Add photos
							{/if}
						</Button>
						<input
							bind:this={fileInput}
							type="file"
							accept="image/jpeg,image/png,image/webp,image/gif"
							multiple
							class="hidden"
							onchange={(e) => void onUpload(e.currentTarget.files)}
						/>
					</div>

					<p class="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
						<span class="inline-flex items-center gap-1">
							<span class="size-2 rounded-full bg-zinc-400"></span> pending
						</span>
						<span class="inline-flex items-center gap-1">
							<span class="size-2 rounded-full bg-sky-500"></span> processing
						</span>
						<span class="inline-flex items-center gap-1">
							<span class="size-2 rounded-full bg-emerald-500"></span> done
						</span>
						<span class="inline-flex items-center gap-1">
							<span class="size-2 rounded-full bg-red-500"></span> failed
						</span>
					</p>

					{#if loadingViews && views.length === 0}
						<p class="text-sm text-muted-foreground">Loading views…</p>
					{:else if views.length === 0}
						<p class="text-sm text-muted-foreground">
							No views yet. Add a photo for the embedding pipeline.
						</p>
					{:else}
						<ul class="grid grid-cols-2 gap-2">
							{#each views as v (v.id)}
								{@const isTemp = v.id.startsWith('temp-')}
								{@const status = v.queueStatus}
								<li
									class={cn(
										'group relative overflow-hidden rounded-md border bg-muted/40 ring-offset-2 ring-offset-background',
										queueRingClass(status, isTemp)
									)}
									title={v.queueError
										? `Queue: ${queueLabel(status, isTemp)} — ${v.queueError}`
										: `Queue: ${queueLabel(status, isTemp)}`}
								>
									{#if v.imageUrl}
										<img
											src={v.imageUrl}
											alt=""
											class="aspect-square w-full object-cover"
										/>
									{:else}
										<div
											class="flex aspect-square items-center justify-center text-xs text-muted-foreground"
										>
											No image
										</div>
									{/if}
									<span
										class={cn(
											'absolute top-1 left-1 rounded px-1 py-0.5 text-[9px] font-semibold tracking-wide text-white uppercase shadow',
											isTemp || status === 'pending' || status == null
												? 'bg-zinc-600/90'
												: status === 'processing'
													? 'bg-sky-600/90'
													: status === 'failed'
														? 'bg-red-600/90'
														: 'bg-emerald-600/90'
										)}
									>
										{queueLabel(status, isTemp)}
									</span>
									<div
										class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/55 px-1.5 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100"
									>
										<span>{v.imageHash ? v.imageHash.slice(0, 8) : '…'}</span>
										{#if !isTemp}
											<button
												type="button"
												class="rounded p-0.5 hover:bg-white/20"
												title="Delete view"
												onclick={() => void onDeleteView(v.id)}
											>
												<TrashIcon class="size-3.5" />
											</button>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				{#if error}
					<p class="text-sm text-destructive">{error}</p>
				{/if}

				<Separator />

				<div class="flex flex-col gap-2">
					{#if movingThis}
						<p class="text-sm text-muted-foreground">
							Click the map to set a new position · Esc to cancel
						</p>
					{/if}
					<div class="flex gap-2">
						<Button
							variant={movingThis ? 'default' : 'outline'}
							class="flex-1"
							onclick={onToggleMove}
							aria-pressed={movingThis}
							title={movingThis ? 'Cancel move' : 'Move marker on the map'}
						>
							<MoveIcon class="size-4" />
							{movingThis ? 'Cancel move' : 'Move'}
						</Button>
						<Button
							variant="destructive"
							class="flex-1"
							onclick={() => void onDeleteMarker()}
						>
							<TrashIcon class="size-4" />
							Delete
						</Button>
					</div>
				</div>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
