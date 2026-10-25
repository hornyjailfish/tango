-- Tango Vision EE map — SurrealDB schema (Phase 0)
-- Apply: surreal sql --conn ws://localhost:8008/rpc --user root --pass root --ns main --db vision database/schema.surql

DEFINE TABLE IF NOT EXISTS basemap_revision SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS adapterVersion ON basemap_revision TYPE string;
DEFINE FIELD IF NOT EXISTS contentHash ON basemap_revision TYPE option<string>;
DEFINE FIELD IF NOT EXISTS mallVersion ON basemap_revision TYPE option<number>;
DEFINE FIELD IF NOT EXISTS etag ON basemap_revision TYPE option<string>;
DEFINE FIELD IF NOT EXISTS fetchedAt ON basemap_revision TYPE option<string>;
DEFINE FIELD IF NOT EXISTS syncStatus ON basemap_revision TYPE string; -- ok | stale | error
DEFINE FIELD IF NOT EXISTS lastError ON basemap_revision TYPE option<object>;
DEFINE FIELD IF NOT EXISTS lastError.path ON basemap_revision TYPE string;
DEFINE FIELD IF NOT EXISTS lastError.message ON basemap_revision TYPE string;
DEFINE FIELD IF NOT EXISTS lastError.issues ON basemap_revision TYPE array<string>;
DEFINE FIELD IF NOT EXISTS lastError.fingerprint ON basemap_revision TYPE string;

DEFINE TABLE IF NOT EXISTS basemap_floor SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS number ON basemap_floor TYPE number;
DEFINE FIELD IF NOT EXISTS svg ON basemap_floor TYPE string;
DEFINE FIELD IF NOT EXISTS graph ON basemap_floor TYPE object;
DEFINE FIELD IF NOT EXISTS graphTranslation ON basemap_floor TYPE object;
DEFINE FIELD IF NOT EXISTS portals ON basemap_floor TYPE array<object>;
DEFINE FIELD IF NOT EXISTS elements ON basemap_floor TYPE object;
DEFINE FIELD IF NOT EXISTS idToPoints ON basemap_floor TYPE object;
DEFINE FIELD IF NOT EXISTS disabled ON basemap_floor TYPE array<string>;

DEFINE TABLE IF NOT EXISTS shop_cache SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS id ON shop_cache TYPE string;
DEFINE FIELD IF NOT EXISTS name ON shop_cache TYPE string;
DEFINE FIELD IF NOT EXISTS description ON shop_cache TYPE option<string>;
DEFINE FIELD IF NOT EXISTS shortDescription ON shop_cache TYPE option<string>;
DEFINE FIELD IF NOT EXISTS logo ON shop_cache TYPE option<string>;
DEFINE FIELD IF NOT EXISTS color ON shop_cache TYPE option<string>;
DEFINE FIELD IF NOT EXISTS floor ON shop_cache TYPE option<number>;
DEFINE FIELD IF NOT EXISTS categories ON shop_cache TYPE array<string>;
DEFINE FIELD IF NOT EXISTS searchTags ON shop_cache TYPE option<string>;
DEFINE FIELD IF NOT EXISTS roomNumber ON shop_cache TYPE option<string>;
DEFINE FIELD IF NOT EXISTS isActive ON shop_cache TYPE bool;
DEFINE FIELD IF NOT EXISTS updatedAt ON shop_cache TYPE option<string>;

DEFINE TABLE IF NOT EXISTS category_cache SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS id ON category_cache TYPE string;
DEFINE FIELD IF NOT EXISTS name ON category_cache TYPE string;

DEFINE TABLE IF NOT EXISTS mall_cache SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS id ON mall_cache TYPE string;
DEFINE FIELD IF NOT EXISTS name ON mall_cache TYPE option<string>;
DEFINE FIELD IF NOT EXISTS mallVersion ON mall_cache TYPE option<number>;
DEFINE FIELD IF NOT EXISTS defaultFloorNumber ON mall_cache TYPE option<number>;