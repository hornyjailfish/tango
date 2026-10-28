/**
 * SurrealDB access over the HTTP RPC endpoint (`POST /rpc`).
 * The surrealdb.js SDK pins engines <2.0.0 while our DB is 3.x — so we speak
 * the version-stable JSON-RPC surface with plain fetch instead.
 */
const HOST = (process.env.SURREALDB_HOST ?? 'http://localhost:8008').replace(/\/+$/, '');
const NS = process.env.SURREALDB_NAMESPACE ?? 'main';
const DB = process.env.SURREALDB_NAME ?? 'vision';
const USER = process.env.SURREALDB_USER ?? 'root';
const PASS = process.env.SURREALDB_PASSWORD ?? 'root';

const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

let requestId = 0;

interface RpcStatement {
	status: 'OK' | 'ERR';
	result: unknown;
}

/**
 * Run a SURQL script with bound variables. Returns one result per statement.
 * Throws on transport errors and on any statement with status "ERR".
 *
 * Note: JSON-RPC bind params coerce bare `table:id`-looking strings into
 * RecordIds. For payloads that contain such strings (e.g. shop searchTags),
 * pass JSON text and decode in SURQL via `encoding::json::decode($json)`.
 */
export async function query<T = unknown>(
	sql: string,
	vars: Record<string, unknown> = {}
): Promise<T[]> {
	const res = await fetch(`${HOST}/rpc`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json',
			authorization: AUTH,
			'surreal-ns': NS,
			'surreal-db': DB
		},
		body: JSON.stringify({ id: ++requestId, method: 'query', params: [sql, vars] })
	});
	if (!res.ok) throw new Error(`SurrealDB HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

	const body = (await res.json()) as {
		error?: { message?: string };
		result?: RpcStatement[];
	};
	if (body.error) throw new Error(`SurrealDB RPC: ${body.error.message ?? 'unknown error'}`);

	const statements = body.result ?? [];
	const failed = statements.find((s) => s.status === 'ERR');
	if (failed) {
		const detail =
			typeof failed.result === 'object' && failed.result !== null
				? JSON.stringify(failed.result)
				: String(failed.result);
		throw new Error(`SurrealDB query failed: ${detail.slice(0, 300)}`);
	}
	return statements.map((s) => s.result as T);
}
