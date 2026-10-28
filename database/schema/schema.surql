-- Tango Vision EE map — SurrealDB schema (Phase 0)
-- Apply: surreal sql --endpoint http://localhost:8008 --user root --pass root --namespace main --database vision < database/schema/schema.surql
-- Record ids use table:key (e.g. shop_cache:6839b4e7…). App strips prefix on read.
--
-- Surreal option<T> = none | T only. JSON/JS null is separate → use option<T | null>.
-- Dynamic nested maps need FLEXIBLE under SCHEMAFULL.
-- Field defs use OVERWRITE so re-applying schema actually updates types.

DEFINE TABLE IF NOT EXISTS basemap_revision SCHEMAFULL;
DEFINE FIELD OVERWRITE adapterVersion ON basemap_revision TYPE string;
DEFINE FIELD OVERWRITE contentHash ON basemap_revision TYPE option<string | null>;
DEFINE FIELD OVERWRITE mallVersion ON basemap_revision TYPE option<number | null>;
DEFINE FIELD OVERWRITE etag ON basemap_revision TYPE option<string | null>;
DEFINE FIELD OVERWRITE fetchedAt ON basemap_revision TYPE option<datetime | string | null>;
DEFINE FIELD OVERWRITE syncStatus ON basemap_revision TYPE string; -- ok | stale | error
DEFINE FIELD OVERWRITE lastError ON basemap_revision TYPE option<object | null> FLEXIBLE;

DEFINE TABLE IF NOT EXISTS basemap_floor SCHEMAFULL;
DEFINE FIELD OVERWRITE number ON basemap_floor TYPE number;
DEFINE FIELD OVERWRITE svg ON basemap_floor TYPE string;
DEFINE FIELD OVERWRITE graph ON basemap_floor TYPE object FLEXIBLE;
DEFINE FIELD OVERWRITE graphTranslation ON basemap_floor TYPE object FLEXIBLE;
DEFINE FIELD OVERWRITE portals ON basemap_floor TYPE array<object> FLEXIBLE;
DEFINE FIELD OVERWRITE elements ON basemap_floor TYPE object FLEXIBLE;
DEFINE FIELD OVERWRITE idToPoints ON basemap_floor TYPE object FLEXIBLE;
DEFINE FIELD OVERWRITE disabled ON basemap_floor TYPE array<string>;

DEFINE TABLE IF NOT EXISTS shop_cache SCHEMAFULL;
-- Surreal id = shop_cache:<tangoId>. App maps to bare tango id on read.
DEFINE FIELD OVERWRITE name ON shop_cache TYPE string;
DEFINE FIELD OVERWRITE description ON shop_cache TYPE option<string | null>;
DEFINE FIELD OVERWRITE shortDescription ON shop_cache TYPE option<string | null>;
DEFINE FIELD OVERWRITE logo ON shop_cache TYPE option<string | null>;
DEFINE FIELD OVERWRITE color ON shop_cache TYPE option<string | null>;
DEFINE FIELD OVERWRITE floor ON shop_cache TYPE option<number | null>;
DEFINE FIELD OVERWRITE categories ON shop_cache TYPE array<string>;
DEFINE FIELD OVERWRITE searchTags ON shop_cache TYPE option<string | null>;
DEFINE FIELD OVERWRITE roomNumber ON shop_cache TYPE option<string | null>;
DEFINE FIELD OVERWRITE isActive ON shop_cache TYPE bool;
DEFINE FIELD OVERWRITE updatedAt ON shop_cache TYPE option<string | null | datetime>;

DEFINE TABLE IF NOT EXISTS category_cache SCHEMAFULL;
DEFINE FIELD OVERWRITE name ON category_cache TYPE string;

DEFINE TABLE IF NOT EXISTS mall_cache SCHEMAFULL;
DEFINE FIELD OVERWRITE name ON mall_cache TYPE option<string | null>;
DEFINE FIELD OVERWRITE mallVersion ON mall_cache TYPE option<number | null>;
DEFINE FIELD OVERWRITE defaultFloorNumber ON mall_cache TYPE option<number | null>;
DEFINE FIELD OVERWRITE logotype ON mall_cache TYPE option<string | null>;
-- MallTheme tokens object (primary, border, highlight, …)
DEFINE FIELD OVERWRITE theme ON mall_cache TYPE option<object | null> FLEXIBLE;
