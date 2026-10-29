-- VPR markers + views + embedding queue (Phase 5 slice)
-- Plan coords stored as geometry<point> [x, y] in local SVG space (not WGS84).
-- Images live in Surreal file bucket `marker_images` (TYPE file on marker_views.image_url).
-- Requires Surreal process:
--   SURREAL_CAPS_ALLOW_EXPERIMENTAL=files
--   SURREAL_BUCKET_FOLDER_ALLOWLIST=<dir matching BACKEND below>   (; separates paths on Windows)
--   restart surreal after changing env
-- Loaded by surrealkit via database/schema/**/*.surql

-- Local FS backend for marker photos ONLY (this project).
-- Logical bucket name is always `marker_images` — do not reuse ee_map `map` or other buckets.
-- URL form matters on Windows: file:/// + ?lowercase_paths=true
-- (plain file:/ fails allowlist check with \\?\ paths).
-- Allowlist this exact folder on the Surreal process (Windows `;`-separated):
--   C:\Users\User\gits\vision\data\bucket
DEFINE BUCKET IF NOT EXISTS marker_images
	BACKEND "file:///C:/Users/User/gits/vision/data/bucket?lowercase_paths=true"
	PERMISSIONS FULL;

-- Stub for later EE/zone linking (search table not ready yet)
DEFINE TABLE IF NOT EXISTS zones SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD OVERWRITE name ON zones TYPE string DEFAULT '';

DEFINE TABLE IF NOT EXISTS markers SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD OVERWRITE level ON markers TYPE record<basemap_floor>;
DEFINE FIELD OVERWRITE zone ON markers TYPE option<record<zones> | null>;
-- Local plan point: GeoJSON Point coordinates = [x, y] in floor SVG space
DEFINE FIELD OVERWRITE geometry ON markers TYPE geometry<point>;
DEFINE FIELD OVERWRITE label ON markers TYPE option<string | null>;
DEFINE FIELD OVERWRITE created_at ON markers TYPE datetime DEFAULT time::now() READONLY;
DEFINE FIELD OVERWRITE updated_at ON markers TYPE datetime VALUE time::now() DEFAULT time::now();

DEFINE INDEX IF NOT EXISTS markers_level ON markers FIELDS level;

-- SHA-256 of image content. Accepts raw bytes (file::get) or base64 string.
-- crypto::sha256 only takes string, so bytes are base64-encoded first (Surreal unpadded).
DEFINE FUNCTION OVERWRITE fn::image_hash($data: any) {
	IF $data == NONE OR $data == NULL {
		RETURN NONE;
	};
	LET $payload = IF type::is_bytes($data) {
		encoding::base64::encode($data)
	} ELSE IF type::is_string($data) {
		$data
	} ELSE {
		NONE
	};
	IF $payload == NONE {
		RETURN NONE;
	};
	RETURN crypto::sha256($payload);
};

DEFINE TABLE IF NOT EXISTS marker_views SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD OVERWRITE marker ON marker_views TYPE record<markers>;
-- Surreal file pointer into bucket `marker_images`
DEFINE FIELD OVERWRITE image_url ON marker_views TYPE option<file | null>;
DEFINE FIELD OVERWRITE content_type ON marker_views TYPE option<string | null>;
-- Content fingerprint via fn::image_hash (bytes or base64). Skip when no image_url.
DEFINE FIELD OVERWRITE image_hash ON marker_views TYPE option<string | null>
	VALUE IF $this.image_url != NONE { fn::image_hash(file::get($this.image_url)) } ELSE { NONE }
	DEFAULT IF $this.image_url != NONE { fn::image_hash(file::get($this.image_url)) } ELSE { NONE };
DEFINE FIELD OVERWRITE created_at ON marker_views TYPE datetime DEFAULT time::now() READONLY;

DEFINE INDEX IF NOT EXISTS marker_views_marker ON marker_views FIELDS marker;

DEFINE TABLE IF NOT EXISTS embeddings SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD OVERWRITE embedding ON embeddings TYPE option<array<float> | null>;
DEFINE FIELD OVERWRITE model ON embeddings TYPE string DEFAULT 'gberton/MegaLoc';
DEFINE FIELD OVERWRITE data ON embeddings TYPE record<marker_views>;

DEFINE INDEX IF NOT EXISTS embeddings_data ON embeddings FIELDS data UNIQUE;

DEFINE INDEX IF NOT EXISTS megaloc_idx
    ON embeddings COLUMNS embedding HNSW DIMENSION 8448 DIST COSINE;

DEFINE TABLE IF NOT EXISTS embedding_queue SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD OVERWRITE data ON embedding_queue TYPE option<record<marker_views> | null>;
-- Content hash of the view image when this queue row was (re)queued.
DEFINE FIELD OVERWRITE hash_snapshot ON embedding_queue TYPE option<string | null>;
DEFINE FIELD OVERWRITE status ON embedding_queue TYPE string DEFAULT 'pending'
	ASSERT $value INSIDE ['pending', 'processing', 'failed', 'done'];
DEFINE FIELD OVERWRITE error_message ON embedding_queue TYPE option<string | null>;
DEFINE FIELD OVERWRITE updated_at ON embedding_queue TYPE datetime VALUE time::now() DEFAULT time::now();

DEFINE INDEX IF NOT EXISTS embedding_queue_status ON embedding_queue FIELDS status;

-- On view add/update: (re)queue when image or content hash changes.
-- Legacy version/version_snapshot fields are dropped in rollout steps (not here).
-- hash_snapshot tracks which image_hash the queue item was for; mismatch → pending.
DEFINE EVENT OVERWRITE add_embedding_task ON TABLE marker_views
	WHEN $event != 'DELETE'
		AND $after.image_url != NONE
		AND $after.image_hash != NONE
	THEN {
		LET $hash = $after.image_hash;
		LET $qid = type::record('embedding_queue', record::id($after.id));
		LET $q = (SELECT * FROM ONLY $qid);
		LET $changed = $before == NONE
			OR $before.image_url != $after.image_url
			OR $before.image_hash != $hash;
		-- Existing queue row still pointing at an old hash (e.g. worker mid-flight)
		LET $mismatch = $q != NONE AND $q.hash_snapshot != $hash;

		IF $changed OR $mismatch OR $q == NONE {
			UPSERT $qid SET
				data = $after.id,
				hash_snapshot = $hash,
				status = 'pending',
				error_message = NONE;
		};
	};

DEFINE EVENT OVERWRITE remove_embedding_task ON TABLE marker_views
	WHEN $event == 'DELETE'
	THEN {
		LET $file = $before.image_url;
		IF $file != NONE {
			file::delete($file);
		};
		DELETE type::record('embedding_queue', record::id($before.id));
		DELETE embeddings WHERE data = $before.id;
	};
