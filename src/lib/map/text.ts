/** Plain text from HTML facade fields — DOMParser, no regex. */
export function htmlToText(input: string | null | undefined): string {
	if (!input) return '';
	if (typeof DOMParser === 'undefined') return input;
	const doc = new DOMParser().parseFromString(input, 'text/html');
	return (doc.body.textContent ?? '').replace(/\u00a0/g, ' ').trim();
}

/** Split comma/semicolon search tags without regex. */
export function splitTags(raw: string | null | undefined): string[] {
	if (!raw) return [];
	const out: string[] = [];
	let buf = '';
	for (let i = 0; i < raw.length; i += 1) {
		const ch = raw[i];
		if (ch === ',' || ch === ';') {
			const t = buf.trim();
			if (t) out.push(t);
			buf = '';
		} else {
			buf += ch;
		}
	}
	const last = buf.trim();
	if (last) out.push(last);
	return out;
}
