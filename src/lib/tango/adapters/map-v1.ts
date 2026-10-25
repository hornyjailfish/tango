import { z } from 'zod';

export const MAP_ADAPTER_VERSION = 'tango-map-v1';

const edgeSchema = z.looseObject({
	from: z.string(),
	to: z.string(),
	distance: z.number(),
	d: z.string().nullish(),
	fromFloor: z.number(),
	toFloor: z.number(),
	bidirectional: z.boolean().nullish(),
	id: z.string()
});

const portalSchema = z.looseObject({
	id: z.string(),
	type: z.string(),
	fromFloor: z.number(),
	toFloors: z.array(z.number()),
	accessible: z.boolean().nullish()
});

const elementSchema = z.looseObject({
	attr: z.looseObject({ class: z.string().nullish() })
});

export const floorSchema = z.looseObject({
	number: z.number(),
	snap: z.string().min(1),
	graph: z.looseObject({
		nodes: z.array(z.string()).min(1),
		edges: z.array(edgeSchema)
	}),
	graphTranslation: z.looseObject({ x: z.number(), y: z.number() }).nullish(),
	portals: z.array(portalSchema),
	elements: z.record(z.string(), elementSchema),
	idToPoints: z.record(z.string(), z.array(z.string())),
	disabled: z.array(z.string()).nullish()
});

/** mapConfig (3D) is deliberately NOT part of the contract — plan.md says ignore it. */
export const mapSchema = z.looseObject({
	_id: z.string().min(1),
	floors: z.array(floorSchema).min(1)
});

export type MapV1 = z.infer<typeof mapSchema>;
export type FloorV1 = z.infer<typeof floorSchema>;

export interface NormalizedFloor {
	number: number;
	svg: string;
	graph: FloorV1['graph'];
	graphTranslation: { x: number; y: number };
	portals: FloorV1['portals'];
	elements: Record<string, { cls: string | null }>;
	idToPoints: Record<string, string[]>;
	disabled: string[];
}

export interface NormalizedMap {
	id: string;
	adapterVersion: string;
	floors: NormalizedFloor[];
}

const NODE_ID_RE = /^-?\d+-[0-9.]+x[0-9.]+$/;

export function decodeSnap(snap: string): string {
	if (snap.includes('<svg')) return snap;
	try {
		return decodeURIComponent(snap);
	} catch {
		return snap;
	}
}

export function normalizeMap(map: MapV1): NormalizedMap {
	return {
		id: map._id,
		adapterVersion: MAP_ADAPTER_VERSION,
		floors: map.floors.map((f) => ({
			number: f.number,
			svg: decodeSnap(f.snap),
			graph: { nodes: f.graph.nodes, edges: f.graph.edges },
			graphTranslation: f.graphTranslation ?? { x: 0, y: 0 },
			portals: f.portals,
			elements: Object.fromEntries(
				Object.entries(f.elements).map(([id, el]) => [id, { cls: el.attr?.class ?? null }])
			),
			idToPoints: f.idToPoints,
			disabled: f.disabled ?? []
		}))
	};
}

/** Invariants beyond Zod (plan.md §Versioning & validation). Returns human-readable failures. */
export function mapInvariants(map: MapV1): string[] {
	const errors: string[] = [];
	if (map.floors.length === 0) errors.push('floors: empty');

	for (const floor of map.floors) {
		const tag = `floor ${floor.number}`;
		const nodes = new Set(floor.graph.nodes);

		for (const node of floor.graph.nodes) {
			if (!NODE_ID_RE.test(node)) errors.push(`${tag}: node id "${node}" breaks /^-?\\d+-[0-9.]+x[0-9.]+$/`);
		}
		for (const edge of floor.graph.edges) {
			if (!nodes.has(edge.from)) errors.push(`${tag}: edge ${edge.id} "from" ${edge.from} not in nodes`);
			if (!nodes.has(edge.to)) errors.push(`${tag}: edge ${edge.id} "to" ${edge.to} not in nodes`);
		}
		for (const [id, points] of Object.entries(floor.idToPoints)) {
			for (const p of points) {
				if (!nodes.has(p)) errors.push(`${tag}: idToPoints[${id}] refs missing node ${p}`);
			}
		}
		const svg = decodeSnap(floor.snap);
		if (!svg.includes('<svg')) errors.push(`${tag}: snap does not decode to <svg>`);
		else if (!svg.includes('<path')) errors.push(`${tag}: snap SVG has no <path> geometry`);
	}
	return errors;
}