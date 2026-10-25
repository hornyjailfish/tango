# Vision — build plan

Internal **navigation + VPR** layer for an EE crew on top of a mall basemap from Tango Vision (read-only).  
Not a Tango clone. No 3D.

---

## Product

| In scope | Out of scope (for now) |
|---|---|
| Interactive **2D** mall map | 3D / GLB / Three / extrude |
| Multi-floor switcher | Official Tango SDK / iframe embed |
| Graph routing A→B (client-side) | Ladder/tool logistics solver |
| Common zones + **electrical rooms** (our data) | Writing back to Tango |
| Shop labels/search from Tango cache | Full CMS (news, banners, marketing) |
| VPR: photo → embeddings → pin on map | Perfect TSP / multi-stop planner (later) |
| SurrealDB as system of record | Angular ngsw / their PWA |

**Users:** internal electrical engineering team.  
**Flow later:** field message/photo → embeddings → match dataset → confirm marker on map → (optional) batch route plan.

---

## Architecture principle

```text
Tango API          = read-only basemap + POI catalog
SurrealDB          = our truth (zones, EE rooms, VPR, jobs, images)
SvelteKit frontend = 2D map UI + client routing
```

**Never** store EE rooms inside a fake Tango schema.  
**Optional soft links** from our records → Tango ids / graph nodes only.

### Layers on the map

```text
0  Floor SVG (Tango snap)
1  Route polyline (graph)
2  Shops / POI labels (Tango shop cache) — secondary
3  EE rooms + common zones (Surreal)     — primary ops layer
4  VPR markers / work pins (Surreal)
```

---

## External API (Tango)

Base: `https://api.tango.vision`  
CORS open on probed GETs. **Cache everything in Surreal**; don’t depend on live Tango at runtime.

### Endpoints we use

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/mall/:mallId` | Meta, `mallVersion`, schedule, UI settings, `navigation_items`, `figmaUrl` |
| `GET` | `/mall/:mallId/map` | **Basemap** — floors, SVG, graph, portals (`mapConfig` ignored) |
| `GET` | `/mall/:mallId/map?3d=true` | Same family; we still ignore 3D |
| `GET` | `/shop?mall=:mallId` | All POIs/shops (~259 for Dmitrovka) |
| `GET` | `/shop/:id` | Detail (+ news/activities if ever needed) |
| `GET` | `/category?mall=:mallId` | Categories (~38) |
| `GET` | `/mall/:mallId/sdk-token` | Public token → `X-Access-Token` (analytics only; **not required**) |

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

| Piece | Role |
|---|---|
| `snap` | Visual geometry (`decodeURIComponent` → SVG paths) |
| `graph` | Walk network; **routing is client-side** (no route API) |
| `portals` | Stairs / elevator / escalator / travelator — connect floors (not in edges) |
| `elements` | Type tags: `object`, `kiosk`, `toilet`, `elevator`, … |
| `idToPoints` | Join key to shops and route targets |
| Node id format | `{floor}-{x}x{y}` e.g. `2-628.68x947.651` |

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

## Versioning & validation

**Map body has no schema version.**  
**Mall meta does:**

| Signal | Source | Use |
|---|---|---|
| `mallVersion` (int) | `GET /mall/:id` | Cheap “anything changed?” |
| `ETag` | HTTP on mall/shops | Conditional fetch |
| Shop `updatedAt` / `__v` | shop records | Per-row freshness |
| **Our** `adapterVersion` | Surreal | e.g. `map-v1` Zod contract |
| **Our** `contentHash` | hash of normalized map | Detect geometry/graph edits |

### Sync flow

```text
1. GET /mall/:id
2. if mallVersion + ETag unchanged → stop
3. GET /map, /shop, /category
4. Zod safeParse (MapV1 / ShopV1)
5. Invariant checks (edges ref nodes, idToPoints valid, snap decodes)
6. Upsert Surreal basemap cache; keep last-good on failure
7. Soft-reanchor our EE rooms if basemap hash changed
```

### Invariants (beyond Zod)

- Every edge `from`/`to` ∈ nodes  
- Node ids match `/^-?\d+-[0-9.]+x[0-9.]+$/`  
- `idToPoints` values ref real nodes  
- `snap` decodes to SVG with paths  
- Floors non-empty  

---

## Our data (SurrealDB)

### Cache (mirror Tango)

- `tango_mall` — meta, mallVersion, etag, settings subset  
- `tango_floor` — number, snap/svg, graph, portals, translation  
- `tango_shop` — POI catalog  
- `tango_category` — categories  
- `basemap_revision` — contentHash, adapterVersion, fetchedAt  

### Domain (we own)

- `ee_room` / `zone` — electrical rooms, risers, common zones  
  - `mall_id`, `name`, `kind`, `floor`  
  - geometry: `outline` polygon and/or `center {x,y}`  
  - anchors: `tango_node_ids[]`, optional `tango_object_id`  
  - `basemap_rev` when last snapped  
  - ops meta: notes, hazard, access, ladder hint (string only — no solver)  
- `vpr_hit` / `marker` — confirmed searches  
  - embedding ref, image (bucket), `nodeId`, floor, xy, confidence, user  
- `work_order` (later) — batch of markers, optional planned order  
- auth/users as needed  

**Images + embeddings:** Surreal v3 bucket + vector features (per product direction).

---

## Frontend stack

| Piece | Choice |
|---|---|
| App | **SvelteKit** |
| Basemap | Decoded floor SVG |
| Pan/zoom | `@panzoom/panzoom` via `onMount` / **attachment** |
| Routing | `graphology` + shortest path (Dijkstra on `distance`) |
| Validation | Zod (shared MapV1/ShopV1) |
| Data | `surrealdb.js` (+ TanStack Query if useful) |
| UI | shadcn-svelte / Bits — side panel, floor switcher |
| Explicitly skip | Three, Threlte, Leaflet/Mapbox, Tango web-sdk |

### Multi-floor routing

- Per-floor graphs from edges  
- Add synthetic portal edges between floors using portal `idToPoints`  
- Path UI splits legs per floor + portal steps  

### VPR UI (later)

1. Upload/capture image  
2. Backend embed + query Surreal  
3. Top-K results → pins on map (snap to nearest graph node)  
4. User confirms → persistent marker  

### Batch “best path” (later, low prio)

- Confirmed markers → pairwise Dijkstra matrix → nearest-neighbor + **2-opt**  
- Not TSP-with-tools; no ladder inventory solver  

---

## Backend / services

- SvelteKit server routes or small API next to Surreal  
- Jobs: Tango sync cron; embedding worker for VPR  
- Secrets: Surreal creds only; Tango token not required for core  

Messenger ingest (WhatsApp/Telegram/etc.): **later**; design API so any ingest drops image+text → VPR pipeline.

---

## Implementation phases

### Phase 0 — skeleton

- [ ] SvelteKit app + env  
- [ ] Surreal connection  
- [ ] Zod schemas `MapV1`, `MallV1`, `ShopV1`  

### Phase 1 — basemap viewer

- [ ] Sync job: mall + map + shops → Surreal  
- [ ] Floor SVG render + pan/zoom attachment  
- [ ] Floor switcher (`defaultFloorNumber` from mall settings as default)  
- [ ] Ignore `mapConfig`  

### Phase 2 — navigation

- [ ] Build in-memory graph from cached floors + portals  
- [ ] Click destination (shop or node) → route draw  
- [ ] Optional “from” pin / locate stub  

### Phase 3 — our zones / EE rooms

- [ ] `ee_room` CRUD  
- [ ] Draw polygons/points layer  
- [ ] Anchor to `tango_node_ids` for routing  
- [ ] Seed common zones from map classes / `navigation_items` if useful (copy into our table)  

### Phase 4 — VPR

- [ ] Image bucket + embedding pipeline  
- [ ] Search API → ranked zones/nodes  
- [ ] Confirm → marker on map  
- [ ] Dataset management UI (minimal)  

### Phase 5 — crew polish (as needed)

- [ ] Search shops/zones text  
- [ ] Work list of confirmed markers  
- [ ] Optional multi-stop 2-opt plan  
- [ ] Auth / roles  

---

## Implementation notes

- Pull live data via the curl commands below (no checked-in API dumps).
- When writing floor SVGs for the viewer: root `<svg>` needs `xmlns` (Tango puts it on an inner `<g>`); never nest `<?xml>` if merging floors.
- Do not commit Tango `sdk-token` values; core GETs work without them.

---

## Design decisions (locked)

1. **2D only** — drop all 3D paths.  
2. **SvelteKit** — libs via `onMount` / attachments.  
3. **Tango = basemap**; **Surreal = ops + VPR + EE rooms**.  
4. **Routing client-side** on cached graph (same as Tango QR app).  
5. **Our adapter version + Zod** — Tango has no map schema version.  
6. **Shop API is POI catalog** — join on `_id`; not a place to store electrical rooms.  
7. **SDK token optional** — public, mainly analytics; core GETs work without it.  
8. **Hard problems later** — ladder heights, tool depots, multi-stop with constraints.  

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

- Open app → see Dmitrovka floor plan, switch floors, pan/zoom  
- Search or pick a shop → route drawn on graph  
- Create an electrical room on a floor → stored in Surreal, visible on layer 3  
- (VPR slice) upload image → get candidate pins → confirm one  

When that works, the rest is enrichment.
