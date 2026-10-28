/** Tango SVG ids: `6839…(object)`, `el4(elevator|1)`, `…(toilet)d`, bare ids. */
export function parseSvgId(raw: string | null | undefined): {
	entityId: string;
	hint: string | null;
} | null {
	if (!raw) return null;
	const open = raw.indexOf('(');
	if (open <= 0) return { entityId: raw, hint: null };
	// first matching `)` — trailing junk after paren is common (`(toilet)d`)
	const close = raw.indexOf(')', open + 1);
	if (close < 0) return { entityId: raw, hint: null };
	const entityId = raw.slice(0, open).trim();
	if (!entityId) return { entityId: raw, hint: null };
	const inside = raw.slice(open + 1, close);
	const pipe = inside.indexOf('|');
	const hintRaw = pipe >= 0 ? inside.slice(0, pipe) : inside;
	const hint = hintRaw.trim() || null;
	return { entityId, hint };
}

/** Strip scripts / handlers / foreignObject via DOM — no regex. */
export function sanitizeSvg(raw: string): string {
	const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
	const root = doc.documentElement;
	if (!root || root.tagName.toLowerCase() === 'parsererror') return raw;

	for (const node of [...root.querySelectorAll('script, foreignObject')]) {
		node.remove();
	}

	const stripHandlers = (el: Element) => {
		for (const attr of [...el.attributes]) {
			if (attr.name.length >= 2 && attr.name.startsWith('on')) {
				el.removeAttribute(attr.name);
			}
		}
		for (const child of el.children) stripHandlers(child);
	};
	stripHandlers(root);

	return new XMLSerializer().serializeToString(root);
}

/**
 * Graph node id → plan coords.
 * Format: `{floor}-{x}x{y}` e.g. `1-120.5x80`, `-2-10x20`.
 */
export function nodeXY(nodeId: string): { x: number; y: number } | null {
	const xMark = nodeId.lastIndexOf('x');
	if (xMark <= 0) return null;
	const yStr = nodeId.slice(xMark + 1);
	const beforeX = nodeId.slice(0, xMark);

	let i = 0;
	if (beforeX[i] === '-') i += 1;
	let sawDigit = false;
	while (i < beforeX.length) {
		const c = beforeX.charCodeAt(i);
		if (c < 48 || c > 57) break;
		sawDigit = true;
		i += 1;
	}
	if (!sawDigit || beforeX[i] !== '-') return null;

	const xStr = beforeX.slice(i + 1);
	const x = Number(xStr);
	const y = Number(yStr);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	return { x, y };
}

/** Root wrapper ids like `floor 1`, `floor -2`. */
export function isFloorRootId(rawId: string): boolean {
	const t = rawId.trim().toLowerCase();
	if (!t.startsWith('floor')) return false;
	const rest = t.slice('floor'.length).trim();
	if (rest === '') return true;
	return Number.isFinite(Number(rest));
}

export const POI_HINTS = new Set([
	'kiosk',
	'atm',
	'toilet',
	'stairs',
	'escalator',
	'elevator',
	'travelator'
]);

/** `object` = tenant footprint; POI hints; else unknown. */
export function classifyHint(hint: string | null | undefined): 'tenant' | 'poi' | null {
	if (!hint) return null;
	if (hint === 'object') return 'tenant';
	if (POI_HINTS.has(hint)) return 'poi';
	return null;
}
