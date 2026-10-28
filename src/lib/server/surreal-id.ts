/**
 * Surreal record ids are `table:key` (sometimes `table:⟨key⟩`).
 * Tango / map entity ids are bare keys. Always normalize on read.
 */

function stripAngles(s: string): string {
	if (s.startsWith('⟨') && s.endsWith('⟩') && s.length >= 2) {
		return s.slice(1, -1);
	}
	return s;
}

/**
 * @param id - RPC value: string | { tb, id } | bare key
 * @param table - expected table name; if set, only that prefix is stripped
 */
export function recordKey(id: unknown, table?: string): string {
	if (id == null) return '';

	if (typeof id === 'object') {
		const o = id as Record<string, unknown>;
		// JSON-RPC often: { tb: "shop_cache", id: "hex" } or nested id
		const tb = typeof o.tb === 'string' ? o.tb : typeof o.table === 'string' ? o.table : table;
		if ('id' in o) return recordKey(o.id, tb);
		return '';
	}

	let s = String(id).trim();
	if (!s) return '';

	if (table) {
		const prefix = `${table}:`;
		if (s.startsWith(prefix)) s = s.slice(prefix.length);
	} else {
		const colon = s.indexOf(':');
		if (colon >= 0) s = s.slice(colon + 1);
	}

	return stripAngles(s);
}

/** Build `table:key` when you need a record string. */
export function recordId(table: string, key: string | number): string {
	return `${table}:${key}`;
}
