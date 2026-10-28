-- Shop full-text search (edgengram analyzer + BM25) for shop_cache
-- Loaded by surrealkit via database/schema/**/*.surql
--
-- Two corpora so name matches rank above tag-only matches:
--   searchName      = name + roomNumber
--   searchTagsText  = tags only (empty string when null/none)
-- Query: searchName @1@ OR searchTagsText @2@  ORDER BY nameScore, tagScore
-- SurrealDB 3+: FULLTEXT ANALYZER (was SEARCH ANALYZER pre-3.0).

DEFINE ANALYZER OVERWRITE shop_search_engram
	TOKENIZERS blank, class
	FILTERS lowercase, edgengram(2, 8);

DEFINE FIELD OVERWRITE searchName ON shop_cache TYPE string DEFAULT '';
DEFINE FIELD OVERWRITE searchTagsText ON shop_cache TYPE string DEFAULT '';

-- Legacy single corpus (kept so old rows/indexes clean up safely on next sync write).
DEFINE FIELD OVERWRITE searchText ON shop_cache TYPE string DEFAULT '';

DEFINE INDEX OVERWRITE shop_name_bm25 ON shop_cache
	FIELDS searchName
	FULLTEXT ANALYZER shop_search_engram BM25;

DEFINE INDEX OVERWRITE shop_tags_bm25 ON shop_cache
	FIELDS searchTagsText
	FULLTEXT ANALYZER shop_search_engram BM25;

-- Note: old combined index shop_search_bm25 is unused; leave it until a rollout step removes it.
