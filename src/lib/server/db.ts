/**
 * SurrealDB access via the official SDK (HTTP + CBOR).
 * CBOR is required to *send* native values (FileRef, RecordId, bytes, …).
 * Results are coerced to plain JSON-ish values so SvelteKit devalue/load/remote
 * never sees SDK class instances.
 */
import { Surreal, createRemoteEngines } from 'surrealdb';

const HOST = (process.env.SURREALDB_HOST ?? 'http://localhost:8008').replace(/\/+$/, '');
const NS = process.env.SURREALDB_NAMESPACE ?? 'main';
const DB = process.env.SURREALDB_NAME ?? 'vision';
const USER = process.env.SURREALDB_USER ?? 'root';
const PASS = process.env.SURREALDB_PASSWORD ?? 'root';

let client: Surreal | null = null;
let connecting: Promise<Surreal> | null = null;

async function connect(): Promise<Surreal> {
	const db = new Surreal({ engines: createRemoteEngines() });
	await db.connect(HOST, {
		namespace: NS,
		database: DB,
		authentication: {
			username: USER,
			password: PASS
		}
	});
	return db;
}

async function getClient(): Promise<Surreal> {
	if (client) return client;
	if (!connecting) {
		connecting = connect()
			.then((db) => {
				client = db;
				return db;
			})
			.finally(() => {
				connecting = null;
			});
	}
	return connecting;
}

/** Drop cached client after transport failures so the next call reconnects. */
export async function resetDb(): Promise<void> {
	const db = client;
	client = null;
	if (db) {
		try {
			await db.close();
		} catch {
			// ignore
		}
	}
}

function isPlainObject(v: object): boolean {
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}

function isBinary(v: object): boolean {
	return (
		v instanceof ArrayBuffer ||
		ArrayBuffer.isView(v) ||
		(typeof Buffer !== 'undefined' && Buffer.isBuffer(v))
	);
}

/**
 * Turn SDK values into devalue/JSON-safe POJOs.
 * - RecordId / FileRef / Decimal / Uuid / Duration / DateTime → toJSON() (usually string)
 * - Geometry* → GeoJSON plain object
 * - Date kept as Date (devalue supports it)
 * - ArrayBuffer / TypedArray / Buffer kept (for file::get)
 */
export function toPojo<T = unknown>(value: unknown): T {
	return coerce(value) as T;
}

function coerce(value: unknown): unknown {
	if (value == null) return value;

	const t = typeof value;
	if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') return value;
	if (t !== 'object') return value;

	const obj = value as object;

	if (obj instanceof Date) return obj;
	if (isBinary(obj)) return obj;

	// Surreal Value hierarchy + anything else with a meaningful toJSON
	if (!Array.isArray(obj) && !isPlainObject(obj) && typeof (obj as { toJSON?: () => unknown }).toJSON === 'function') {
		return coerce((obj as { toJSON: () => unknown }).toJSON());
	}

	if (Array.isArray(obj)) return obj.map(coerce);

	if (isPlainObject(obj)) {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(obj)) out[k] = coerce(v);
		return out;
	}

	// Last resort: string tag (should be rare)
	return String(obj);
}

async function runQuery(sql: string, vars: Record<string, unknown>): Promise<unknown[]> {
	const db = await getClient();
	return (await db.query(sql, vars).collect()) as unknown[];
}

/**
 * Run a SURQL script with bound variables. Returns one result per statement.
 *
 * Bind SDK values on the way in (`FileRef`, `RecordId`, `Uint8Array`, …).
 * Results are POJO-coerced for SvelteKit serialization.
 */
export async function query<T = unknown>(
	sql: string,
	vars: Record<string, unknown> = {}
): Promise<T[]> {
	try {
		return toPojo<T[]>(await runQuery(sql, vars));
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (/connect|closed|reset|socket|unavailable|network/i.test(msg)) {
			await resetDb();
			return toPojo<T[]>(await runQuery(sql, vars));
		}
		throw err;
	}
}

/**
 * Same as `query` but skips POJO coercion — for rare cases that need raw SDK
 * instances or to inspect binary without walking the tree.
 */
export async function queryRaw<T = unknown>(
	sql: string,
	vars: Record<string, unknown> = {}
): Promise<T[]> {
	try {
		return (await runQuery(sql, vars)) as T[];
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (/connect|closed|reset|socket|unavailable|network/i.test(msg)) {
			await resetDb();
			return (await runQuery(sql, vars)) as T[];
		}
		throw err;
	}
}
