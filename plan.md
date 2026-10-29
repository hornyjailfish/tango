# Vision — build plan

Internal **navigation + electrical ops + VPR** layer for an EE crew on top of a mall basemap from Tango Vision (read-only).  
Not a Tango clone. No 3D.

---

## Product

| In scope                                                        | Out of scope (for now)                   |
| --------------------------------------------------------------- | ---------------------------------------- |
| Interactive **2D** mall map                                     | 3D / GLB / Three / extrude               |
| Multi-floor switcher                                            | Official Tango SDK / iframe embed        |
| Walk routing A→B (client-side, Tango graph)                     | Ladder/tool logistics solver             |
| Zones + **EE rooms** (our data)                                 | Writing back to Tango                    |
| **Power topology**: rooms → boards → breakers → loads           | Full IEC / protection-study tooling      |
| Unified search: shop / room / board / breaker → map + feed path | Full CMS (news, banners, marketing)      |
| Shop labels from Tango cache                                    | Angular ngsw / their PWA                 |
| VPR: photo → embeddings → pin on map                            | Perfect TSP / multi-stop planner (later) |
| SurrealDB as system of record                                   |                                          |

**Users:** internal electrical engineering team.  
**Core crew questions:**

- How do I walk to X?
- What feeds this shop / load? (breaker → board → room)
- Photo → which zone/room is this?

**Flow later:** field message/photo → embeddings → match dataset → confirm marker on map → (optional) batch walk plan.

---

## Architecture principle

```text
Tango API          = read-only basemap + POI catalog + walk graph
SurrealDB          = our truth (zones, EE, power graph, VPR, jobs, images)
SvelteKit frontend = 2D map UI + walk routing + search + power path UI
```

**Two graphs:**

| Graph     | Meaning               | Owner                                      |
| --------- | --------------------- | ------------------------------------------ |
| **Walk**  | How people move       | Tango `floors[].graph` + portals (cached)  |
| **Power** | How electricity feeds | Our Surreal: room → board → breaker → load |

**Never** store EE rooms / boards / breakers inside a fake Tango schema.  
**Optional soft links** from our records → Tango shop ids / graph nodes only.

### Layers on the map

```text
0  Floor plate (Tango snap `over` group) — always on
1  Walls (Tango snap `g#wall`)
2  Walk paths (Tango snap `waypath` — red/blue strokes; hideable)
3  Tenants / shops (Tango `objects` groups `*(object)` — clickable → shop_cache)
4  POI (kiosk / toilet / elevator / stairs / …)
5  Walk *route* polyline (graph Dijkstra — Phase 2)
6  EE rooms + common zones (Surreal)     — primary ops layer
7  Boards (pins inside rooms)
8  Selection: power-path highlight (shop ↔ breaker ↔ board ↔ room)
9  VPR markers / work pins (Surreal)
```

**Not map layers:** shop categories (badges / search only).

---

## External API (Tango)

Base: `https://api.tango.vision`  
CORS open on probed GETs. **Cache everything in Surreal**; don’t depend on live Tango at runtime.

### Endpoints we use

| Method | Path                        | Purpose                                                                    |
| ------ | --------------------------- | -------------------------------------------------------------------------- |
| `GET`  | `/mall/:mallId`             | Meta, `mallVersion`, schedule, UI settings, `navigation_items`, `figmaUrl` |
| `GET`  | `/mall/:mallId/map`         | **Basemap** — floors, SVG, graph, portals (`mapConfig` ignored)            |
| `GET`  | `/mall/:mallId/map?3d=true` | Same family; we still ignore 3D                                            |
| `GET`  | `/shop?mall=:mallId`        | All POIs/shops (~259 for Dmitrovka)                                        |
| `GET`  | `/shop/:id`                 | Detail (+ news/activities if ever needed)                                  |
| `GET`  | `/category?mall=:mallId`    | Categories (~38)                                                           |
| `GET`  | `/mall/:mallId/sdk-token`   | Public token → `X-Access-Token` (analytics only; **not required**)         |

### Example mall

- Id: `6804d32a394e07fd48a1447c`
- Name: Tashir - RIO Dmitrovka SM
- Floors in map: `-2, -1, 1, 2, 3`

### Do not use

- `https://sdk.tango.vision/web-sdk-latest.js` — iframe embed remote control
- `https://qr.tango.vision/ngsw-worker.js` — Angular PWA worker
- Their internal `tv-3d-sdk` (bundled in QR app)
- `mapConfig.threeDObjects` / GLBs
- Figma as runtime source (SVG already in map; `figmaUrl` is design reference only)

---

## Map JSON structure (`GET /mall/:id/map`)

```text
{
  _id,
  floors: [
    {
      number,                 // floor index
      snap,                   // URL-encoded SVG (from Figma via Tango)
      graph: {
        nodes: ["1-227x964", ...],   // id encodes floor-x-y
        edges: [{ from, to, distance, d, fromFloor, toFloor, bidirectional, id }]
      },
      graphTranslation: { x, y },    // 0,0 here — graph aligned to SVG
      portals: [{ id, type, fromFloor, toFloors, accessible }],
      elements: { [id]: { attr: { class } } },
      idToPoints: { [id]: ["1-428x946", ...] },  // POI → graph node(s)
      disabled: [id...],
      iconUrl
    }
  ],
  mapConfig  // IGNORE (3D placements)
}
```

### Semantics

| Piece          | Role                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| `snap`         | Visual geometry (`decodeURIComponent` → SVG paths)                         |
| `graph`        | Walk network; **routing is client-side** (no route API)                    |
| `portals`      | Stairs / elevator / escalator / travelator — connect floors (not in edges) |
| `elements`     | Type tags: `object`, `kiosk`, `toilet`, `elevator`, …                      |
| `idToPoints`   | Join key to shops and route targets                                        |
| Node id format | `{floor}-{x}x{y}` e.g. `2-628.68x947.651`                                  |

### Shop ↔ map join

```text
shop._id  ===  elements[id]  ===  idToPoints[id]
```

For Dmitrovka: **259/259 shops** present on map.  
“Shop” API also includes toilets/ATMs etc. — filter by map `class` or categories as needed.

### Coordinates

Local plan space (Figma canvas), not GPS. Y grows down (SVG).  
Metric accuracy = design export, not survey CAD.

---

## Versioning & validation (Tango schema drift)

Tango does **not** publish a map schema version. We own the contract.

**Internal tool policy:** last-good cache stays live; **show a clear error/banner to the user** when sync/parse fails. No silent fake data. Ops can keep working on the previous basemap until someone ships an adapter bump.

### Signals we track

| Signal                   | Source                 | Use                                               |
| ------------------------ | ---------------------- | ------------------------------------------------- |
| `mallVersion` (int)      | `GET /mall/:id`        | Cheap “anything changed?”                         |
| `ETag`                   | HTTP on mall/shops     | Conditional fetch                                 |
| Shop `updatedAt` / `__v` | shop records           | Per-row freshness                                 |
| **`adapterVersion`**     | Our code + Surreal     | e.g. `tango-map-v1` — Zod + normalize contract    |
| **`contentHash`**        | Hash of normalized map | Geometry/graph content changed                    |
| **`syncStatus`**         | Surreal                | `ok` \| `stale` \| `error`                        |
| **`lastError`**          | Surreal                | Zod/invariant message + raw fingerprint for debug |

### Adapter versions (our code)

```text
src/lib/tango/adapters/
  map-v1.ts      // Zod MapV1 + normalize()
  shop-v1.ts
  mall-v1.ts
  index.ts       // pick adapter by adapterVersion; try upgrade path
```

- Runtime always pins one **current** adapter (start: `v1`).
- When Tango breaks `v1`, add `map-v2.ts` (or loosen/extend v1), map old rows if needed, bump `ADAPTER_CURRENT`.
- Do **not** auto-guess unknown shapes into production cache.

### What “schema changed” looks like

| Failure                | Example                                                |
| ---------------------- | ------------------------------------------------------ |
| Field removed/renamed  | `floors[].snap` missing; `idToPoints` → `id_to_points` |
| Type change            | `distance` string instead of number                    |
| Graph semantics change | node id format, portals folded into edges              |
| New required envelope  | map wrapped in `{ data: {...} }`                       |
| Partial mall           | empty floors, truncated payload                        |

Zod + invariants catch these **before** Surreal overwrite.

### Sync flow

```text
1. UI load → basemap.ts reads Surreal (mall / floors / shops / revision)
2. If cache empty OR client POST /api/sync:
     GET /mall/:id
     if mallVersion + ETag unchanged and syncStatus=ok → stop (when cache present)
     GET /map, /shop?mall=, /category
     Zod safeParse (MapV1 / ShopV1 / MallV1) + invariants
3a. SUCCESS:
      upsert via cache.ts (JSON string + encoding::json::decode — see notes)
      contentHash, adapterVersion, syncStatus=ok, clear lastError
3b. FAILURE:
      do NOT overwrite last-good basemap
      syncStatus=error, store lastError
      Alert banner on +page (destructive / stale)
4. UI always reads Surreal; Tango only inside sync job
5. Empty cache + API down → graceful error meta (no 500 crash)
```

### User-visible behaviour (internal OK to be blunt)

| State                                     | Map UI                                                 | Search / EE / power                                                        |
| ----------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `ok`                                      | normal                                                 | normal                                                                     |
| `stale` (sync delayed, still valid cache) | normal + mild “last synced …”                          | normal                                                                     |
| `error` (parse/invariant fail)            | **last-good map** + **error banner**                   | EE/power still work on our data; walk/shop bits from last-good Tango cache |
| no cache ever                             | full-screen error: “No basemap — sync failed” + detail | EE CRUD may still work offline of map                                      |

Do not block the whole app on Tango if Surreal already has a good revision — only block first-run with zero cache.

### Invariants (beyond Zod)

- Every edge `from`/`to` ∈ nodes
- Node ids match `/^-?\d+-[0-9.]+x[0-9.]+$/` (v1 assumption; relax in v2 if Tango changes)
- `idToPoints` values ref real nodes
- `snap` decodes to SVG with paths
- Floors non-empty
- Shop `_id` set non-empty when shops payload present

### When contentHash changes but schema OK

Geometry/graph edit from mall side (not contract break):

- Keep EE rooms / boards / breakers / loads as-is
- Mark anchors `needs_revalidate=true` if node ids disappeared
- UI: “Basemap updated — N rooms need re-anchor”
- Soft links to missing `tango_shop_id` → show warning on that load, don’t delete

### Adapter bump checklist (human)

1. Save failing payload sample (private, not git).
2. Diff keys vs MapV1.
3. New adapter or patch v1.
4. Fixture test: old sample + new sample.
5. Deploy; re-run sync; confirm banner clears.
6. Spot-check walk route + `idToPoints` join.

### Our domain schema versioning (separate)

EE/power tables version independently (`ee_schema_version` migrations in Surreal).  
Tango adapter bumps must **not** require rewriting breaker graphs — only spatial anchors/shop fks may need revalidation.

---

## Electrical topology (our power graph)

Crew goal: **search a shop (or breaker) → see where it connects** on the map and as a feed tree.

Tango has **no** boards/breakers/feeds. This is 100% our data, soft-linked to Tango shops for tenancy loads.

### Model

```text
ee_room / zone
  mall_id, name, kind, floor
  center {x,y} | outline[]
  tango_node_ids[]          // walk anchors
  tango_object_id?          // optional
  basemap_rev, needs_revalidate?

board
  ee_room_id, name, floor, xy?
  meta: rating, voltage…

breaker
  board_id, name/label (QFxx), rating…
  parent_breaker_id?        // simple tree for sub-mains (optional)

load
  name, kind: shop | zone | other | unknown
  breaker_id                // leaf feed
  tango_shop_id?            // join Tango POI
  zone_id?

breaker_connection          // optional free-form edges when tree is not enough
  from_type/from_id → to_type/to_id
  kind: feeds | reserve | parallel
```

**Day one can be tree-only** (no `breaker_connection` table):

```text
load.breaker_id → breaker.board_id → board.ee_room_id
(+ breaker.parent_breaker_id if needed)
```

Add explicit connection edges when rings/reserves appear.

### Unified search

One box, multiple indexes:

| Query hits            | Then show                                          |
| --------------------- | -------------------------------------------------- |
| Tango shop name/tags  | shop on map + upstream power path if `load` linked |
| ee_room / zone name   | room polygon + boards                              |
| board / breaker label | board pin + room + downstream loads/shops          |
| VPR image (later)     | zone/room → same electrical panel                  |

**“Where does this shop connect?”**

```text
1. Resolve shop → load (by tango_shop_id) or prompt “link load”
2. Walk power upstream: breaker → board → ee_room (+ parents)
3. Map: highlight shop, room, board; optional walk route to room
4. Drawer tree:
   ADAMAS ← QF12 ← Board 2.1 ← EE-2.14 ← …
```

Default map: don’t draw full power spaghetti — only **selection path** + list.

### Power vs walk

| Question                             | Graph                                                 |
| ------------------------------------ | ----------------------------------------------------- |
| How do I get to the electrical room? | Tango walk graph                                      |
| What feeds shop X?                   | Our power graph                                       |
| Both                                 | Search result can offer “route to room” + “show feed” |

---

## Our data (SurrealDB)

### Cache (mirror Tango)

Implemented table names (schema: `database/schema.surql`).
Access: `src/lib/server/cache.ts` (get/upsert) ← `sync.ts` writes, `basemap.ts` reads.

- `mall_cache` — meta, mallVersion, theme, defaultFloorNumber, logotype
- `basemap_floor` — number, snap/svg (**in DB**), graph, portals, translation
- `shop_cache` — POI catalog (name, logo, floor, categories, searchTags, …)
- `category_cache` — categories
- `basemap_revision` — contentHash, adapterVersion, fetchedAt, syncStatus, lastError

**IDs:** Surreal records are `shop_cache:<tangoId>` etc. App-facing ids are **bare tango hex** via `recordKey()` (`src/lib/server/surreal-id.ts`). SVG object ids match bare shop ids.

**RPC note:** Surreal JSON-RPC bind coerces strings like `re:STORE,…` into RecordIds. Upserts pass `JSON.stringify(rows)` and `encoding::json::decode($json)` in SURQL so `searchTags` stay plain strings.

### Domain (we own)

- `ee_room` / `zone` — electrical rooms, risers, common zones (spatial + ops)
- `board` — panels inside rooms
- `breaker` — devices on boards
- `load` — circuits/tenancies; optional `tango_shop_id`
- `breaker_connection` — optional non-tree power edges
- `markers` — VPR pins on plan (`floor`/`level` → `basemap_floor`, `zone_id?`, geometry point x/y, optional `label`)
- `marker_views` — photos per marker (`image_url` file → bucket `marker_images`, `content_type`, `image_hash`, timestamps)
- `embedding_queue` / `embeddings` — encode jobs + stored vectors (worker/service side)
- `work_order` (later) — batch of markers / jobs
- auth/users as needed

**Images + embeddings:** Surreal file bucket `marker_images` + external MegaLoc FastAPI (`EMBEDDING_SERVICE_URL` / `VPR_SERVICE_URL`). App searches via `POST /api/vpr/search`; encode pipeline is service/queue-owned.

---

## Frontend stack

| Piece           | Choice                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| App             | **SvelteKit** (Svelte 5 runes)                                         |
| Basemap engine  | **PixiJS** — `MapCanvas.svelte` + `src/lib/map/pixi-floor.ts`          |
| Floor SVG       | Parsed once per floor (`over` / `waypath` / `objects`); drawn as Graphics |
| Pan/zoom        | Pixi interaction (no `@panzoom/panzoom`)                               |
| Routing         | Phase 2: `graphology` + Dijkstra on cached `distance` (not started)    |
| Validation      | Zod adapters MapV1 / ShopV1 / MallV1                                   |
| Data            | SurrealDB **HTTP RPC** `fetch` (`db.ts`); no `surrealdb.js` (3.x gate) |
| UI              | shadcn-svelte (vendored) / Bits — sheet, layers, floor tabs, alerts    |
| State           | `src/lib/state/map.svelte.ts` — floor, layers, selection, place/move marker modes, in-memory markers |
| Markers / VPR UI | `MarkerToolbar`, `MarkerPanel`, `VprSearch`; remote cmds in `markers.remote.ts` |
| Explicitly skip | Three, Threlte, Leaflet/Mapbox, Tango web-sdk, category-as-map-layer   |

### Multi-floor routing

- Per-floor graphs from edges
- Add synthetic portal edges between floors using portal `idToPoints`
- Path UI splits legs per floor + portal steps

### Unified search UI

- Single search: shops + ee_rooms + boards + breakers (+ zones)
- Result actions: **focus map**, **show feed path**, **walk route to room**
- Unlinked shop → CTA “Link to breaker/load”

### VPR UI (shipped slice)

1. Drop / pick photo (toolbar **VPR** or window DnD) → `POST /api/vpr/search`
2. Embedding service MegaLoc search (optional floor filter + `min_score` / `top_k`)
3. Top-K hits in panel → click selects/upserts marker + fits map
4. Manual place / move / label / multi-photo on markers (Surreal + bucket)
5. **Later:** auto-confirm into EE room context / power path when rooms exist

### Batch “best walk path” (later, low prio)

- Confirmed markers → pairwise Dijkstra → nearest-neighbor + **2-opt**
- Not TSP-with-tools; no ladder inventory solver

---

## Backend / services

- SvelteKit server routes or small API next to Surreal
- Jobs: Tango sync cron (adapter + status); embedding worker for VPR
- Secrets: Surreal creds only; Tango token not required for core
- Sync failures written to `basemap_revision.lastError`; surface in UI

Messenger ingest (WhatsApp/Telegram/etc.): **later**; design API so any ingest drops image+text → VPR pipeline.

---

## Implementation phases

**Status (2026-03-28): Phase 0–1 done. Phase 5 VPR markers + photo-search slice largely done.**
Next priority still Phase 2 (walk routing) + Phases 3–4 (EE/power); VPR polish as needed.

### Phase 0 — skeleton

- [x] SvelteKit app + env
- [x] Surreal connection (HTTP RPC on port 8008, ns/db `vision`)
- [x] Zod adapters `MapV1`, `MallV1`, `ShopV1` + `ADAPTER_CURRENT` (`src/lib/tango/adapters/`)
- [x] `basemap_revision` row shape including `syncStatus` / `lastError`
- [x] SurrealKit types under `src/lib/types` (schema-driven; app still normalizes via adapters)

### Phase 1 — basemap viewer ✅

- [x] Sync job: mall + map + shops + categories → validate → Surreal (never clobber on fail) — `sync.ts`, empty-cache sync in `basemap.ts`, `POST /api/sync`
- [x] Error / stale **Alert** banners on `+page.svelte` from `revision.syncStatus` + `lastError`
- [x] Empty DB → one blocking Tango sync; API down → graceful error meta (no crash)
- [x] Pixi floor render + pan/zoom (`MapCanvas.svelte`, `pixi-floor.ts`)
- [x] Floor switcher (`defaultFloorNumber` from mall)
- [x] Ignore `mapConfig` / 3D
- [x] Layer switch: **Walls / Tenants / POI / Walk** (base plate always on; categories ≠ layers)
- [x] SVG group parse: `over` (base+walls), `waypath` (walk), `objects` (`(object)` shops, POI hints)
- [x] Shop hit-test on shape path (not loose bbox); click → `SelectionPanel` (Sheet) via bulk `shop_cache`
- [x] Id join: bare tango id ↔ `shop_cache:<id>` via `recordKey`
- [x] Mall theme → CSS / Pixi tint hooks
- [x] shadcn-svelte components vendored under `src/lib/components/ui/`

### Phase 2 — walk navigation

- [ ] In-memory walk graph from cached floors + portals (`graph` nodes/edges + portal links)
- [ ] Click destination (shop via `idToPoints` or node) → route polyline on layer 5
- [ ] Optional “from” pin / locate stub
- [ ] Multi-floor legs via portals

### Phase 3 — zones / EE rooms

- [ ] `ee_room` CRUD + draw layer
- [ ] Anchor to `tango_node_ids`
- [ ] Revalidate flags when `contentHash` changes

### Phase 4 — electrical topology + search

- [ ] `board`, `breaker`, `load` (+ optional `breaker_connection`)
- [ ] Link `load.tango_shop_id`
- [ ] Upstream/downstream walk on power tree
- [ ] Unified search → map focus + feed tree drawer + optional walk-to-room

### Phase 5 — VPR (markers + photo search) — mostly ✅

**Data / server**

- [x] Surreal `markers`, `marker_views`, bucket `marker_images` (`database/schema/markers.surql`)
- [x] CRUD helpers `src/lib/server/markers.ts` + remote `src/lib/markers.remote.ts`
- [x] Image serve `GET /api/marker-images/[...path]`; view upload `POST /api/markers/[id]/views`
- [x] Embedding client `src/lib/server/embedding.ts` → FastAPI MegaLoc (`vprSearch`, `asLabel` normalizer)
- [x] HTTP search API `POST /api/vpr/search` (multipart `image`, optional `top_k`/`min_score`/`floor`/`target`)
- [x] Queue status surfaced on views (`embedding_queue` join for pending/done/error UI)

**Map / UI**

- [x] Place marker mode (click plan → create on current floor)
- [x] Select marker → `MarkerPanel`: label edit, delete marker, **multi-photo** upload (concurrency 3), delete view, lightbox
- [x] **Move marker** mode (sidebar Move → map click → `patchMarker` coords; Esc/cancel; exclusive w/ place mode)
- [x] Floor markers load/refresh; pins on Pixi canvas; selection highlight
- [x] `VprSearch`: panel + window image drop; score threshold slider (rescores last file); **Floor N / All floors** toggle; hardened titles (no `[object Object]`); floor badge = number only
- [ ] Search → ranked **EE zones/rooms** (needs Phase 3 rooms) → confirm into electrical context
- [ ] Auto-ingest path (messenger → VPR) — later

### Phase 6 — crew polish (as needed)

- [ ] Work list / jobs
- [ ] Multi-stop walk 2-opt
- [ ] Auth / roles
- [ ] Admin “last sync error” detail page

---

## Implementation notes

- Pull live data via curl below (no checked-in API dumps). Local `.cache/` is **agent scratch only** — not runtime; safe to delete / gitignore. App cache = Surreal via `cache.ts`.
- shadcn-svelte vendored under `src/lib/components/ui/` (registry often blocked here — copy from shadcn-svelte GitHub / npm package sources; icons `@lucide/svelte`).
- Floor snap is URL-encoded SVG in DB. Structure that matters for Pixi: `g#over` (floor + `g#wall`), `g#waypath`, `g#objects` with ids `{entityId}(hint)` / `{entityId}(hint|subtype)`.
- `parseSvgId` takes first `(…)` hint; trailing junk after `)` ignored.
- Do not commit Tango `sdk-token` values; core GETs work without them.
- Keep failing Tango payloads **out of git**.
- Adapter bump = code change + fixture tests; not a hot config flag.
- Prefer bulk `GET /shop?mall=` once per sync; avoid per-shop fetches for the panel.
- `{#each}` keys: use index when tag strings can duplicate (SelectionPanel).

---

## Design decisions (locked)

1. **2D only** — drop all 3D paths.
2. **SvelteKit + Svelte 5 runes**; map engine **PixiJS** (not DOM SVG + panzoom).
3. **Tango = basemap + walk graph + shop catalog**; **Surreal = EE + power + VPR + ops**.
4. **Walk routing client-side** on cached Tango graph (Phase 2).
5. **Power graph is ours** — rooms/boards/breakers/loads; soft-link shops via `tango_shop_id`.
6. **Our adapter version + Zod** — Tango has no map schema version.
7. **Schema drift:** keep last-good cache; set `syncStatus=error`; **show error to user**. Never overwrite cache with invalid payload.
8. **Shop API is POI catalog** — not a place to store electrical rooms. Categories are metadata, not map layers.
9. **SDK token optional** — analytics only.
10. **Hard problems later** — ladder heights, tool depots, rings/reserves detail, multi-stop constraints.
11. **App ids = bare tango ids**; Surreal record keys `table:id` stripped at cache read boundary.
12. **Bulk shop list once** — panel resolves from in-memory `meta.shops`, not live per-id GETs.

---

## Quick start commands (reference)

```bash
# mall meta
curl -s "https://api.tango.vision/mall/6804d32a394e07fd48a1447c" -o mall.json

# basemap (the big one)
curl -s "https://api.tango.vision/mall/6804d32a394e07fd48a1447c/map" -o map.json

# shops
curl -s "https://api.tango.vision/shop?mall=6804d32a394e07fd48a1447c" -o shops.json

# categories
curl -s "https://api.tango.vision/category?mall=6804d32a394e07fd48a1447c" -o categories.json
```

---

## Success criteria (MVP)

- [x] Open app → Dmitrovka plan, floor switch, pan/zoom (Pixi)
- [x] Toggle walls / tenants / poi / walk; click shop → detail sheet from cache
- [x] Empty DB first run syncs from Tango; API down → banner, no crash
- [x] Bad sync → last-good map + error banner
- [ ] Pick/search shop → walk route on graph *(Phase 2)*
- [ ] Create EE room → on map (Surreal)
- [ ] Board + breaker + load linked to a shop → search shop → **feed tree + room highlight**
- [x] (VPR markers) place / move / label / multi-photo; image → ranked **marker** pins → select on map
- [ ] (VPR→EE) image → candidate **room** pins → confirm + electrical context *(needs Phase 3–4)*

When walk + EE feed path work, the rest is enrichment.

---

## VPR HTTP API (current)

Programmatic — no UI required.

| Method | Path | Body | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/api/vpr/search` | `multipart/form-data` | **`image`** (required); `top_k`/`topK` (default 8, max 30); `min_score`/`minScore` (default 0.35); `floor` (optional → `basemap_floor:N`); `target` (default `markers`) |
| `POST` | `/api/markers/[id]/views` | `multipart` field `image` | Add view photo; triggers encode queue side |
| `GET`  | `/api/marker-images/[...path]` | — | Serve bucket object |
| remotes | `listMarkers` / `placeMarker` / `patchMarker` / `removeMarker` / `listMarkerViews` / `removeMarkerView` | SvelteKit remote functions | UI + scripts via app |

Env: `EMBEDDING_SERVICE_URL` or `VPR_SERVICE_URL` (MegaLoc FastAPI).

---

## Current snapshot

| Area | State |
| ---- | ----- |
| Adapters + vitest | OK (`tango-map-v1`) |
| Sync / cache / basemap load | OK; JSON-decode upserts; `recordKey` ids |
| Pixi map + layers + shop click | OK |
| Selection panel | OK (tags keyed by index) |
| Shop search | OK (`ShopSearch`) |
| shadcn ui kit | Vendored; usable |
| **VPR markers** | **OK** — place, move, delete, label, multi-photo, view queue badges |
| **VPR photo search** | **OK** — UI + `POST /api/vpr/search`; threshold + floor-scope toggle; DnD |
| Embedding service | External MegaLoc; app is client only |
| Walk routing | **Not started** — Phase 2 |
| EE rooms / power topology | **Not started** — Phases 3–4 |
| VPR → EE room context | Blocked on Phase 3–4 |
| `.cache/` on disk | Scratch only; not part of product |

### Recent shipped (markers / VPR)

- Move misplaced pins: panel **Move** → map click → DB coords (`patchMarker` / `updateMarker`)
- Multi-file photo upload on a marker (optimistic previews, ≤3 parallel POSTs, partial-fail reporting)
- VPR result labels: `asLabel` server-side + client `hitTitle` (no `[object Object]`)
- Floor badge plain number; score slider + **This floor / All floors** rescore without re-picking file
