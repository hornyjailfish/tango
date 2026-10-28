import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseMap, parseShops, parseMall, parseCategories } from './index';

const cacheDir = path.resolve('.cache/tango');
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(cacheDir, name), 'utf8'));

describe('live tango fixtures vs adapters', () => {
	it('mall', () => {
		const r = parseMall(read('mall.json'));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.data.id).toBe('6804d32a394e07fd48a1447c');
		expect(r.data.mallVersion).toBeTypeOf('number');
		expect(r.data.defaultFloorNumber).toBe(1);
	});

	it('map', () => {
		const r = parseMap(read('map.json'));
		if (!r.ok) console.error(r.error);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.data.floors.map((f) => f.number)).toEqual([-2, -1, 1, 2, 3]);
		for (const floor of r.data.floors) {
			expect(floor.svg.includes('<svg')).toBe(true);
			expect(Object.keys(floor.elements).length).toBeGreaterThan(0);
		}
	});

	it('shops', () => {
		const r = parseShops(read('shops.json'));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.data.length).toBeGreaterThan(100);
		expect(r.data.some((s) => s.floor === 1 && s.name.length > 0)).toBe(true);
	});

	it('categories', () => {
		const r = parseCategories(read('cats.json'));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.data.length).toBeGreaterThan(10);
	});

	it('svg entity ids match shops/elements after (class) strip', () => {
		const map = parseMap(read('map.json'));
		const shops = parseShops(read('shops.json'));
		expect(map.ok && shops.ok).toBe(true);
		if (!map.ok || !shops.ok) return;
		const shopIds = new Set(shops.data.map((s) => s.id));
		let hits = 0;
		for (const floor of map.data.floors) {
			for (const raw of floor.svg.matchAll(/id="([^"]+)"/g)) {
				const m = /^([^(]+)\(([^)]*)\)$/.exec(raw[1]);
				const entityId = m ? m[1].trim() : raw[1];
				if (shopIds.has(entityId) || floor.elements[entityId]) hits++;
			}
		}
		expect(hits).toBeGreaterThan(50);
	});
});
