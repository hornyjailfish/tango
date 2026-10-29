/** Shared VPR marker types (safe for client + server). */

export type MarkerPoint = { x: number; y: number };

export type MarkerRecord = {
	id: string;
	/** Floor number (basemap_floor key). */
	floor: number;
	zoneId: string | null;
	x: number;
	y: number;
	label: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	viewCount: number;
};

/** embedding_queue.status — null when no queue row yet (treat as pending in UI). */
export type EmbeddingQueueStatus = 'pending' | 'processing' | 'failed' | 'done';

export type MarkerViewRecord = {
	id: string;
	markerId: string;
	/** Object key inside bucket `marker_images`. */
	imageKey: string | null;
	contentType: string | null;
	/** SHA-256 hex of image bytes (null until set). */
	imageHash: string | null;
	createdAt: string | null;
	/** App URL that streams bytes via file::get. */
	imageUrl: string | null;
	/** Latest embedding_queue status for this view (null = no row). */
	queueStatus: EmbeddingQueueStatus | null;
	queueError: string | null;
};
