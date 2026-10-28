import { describe, it, expect } from 'vitest';
import {
	parseMap,
	parseShops,
	parseMall,
	parseCategories,
	decodeSnap,
	normalizeShop
} from './index';

const svg = '<svg><g id="wall"><path id="Vector" d="M0 0L10 10"/></g></svg>';

function mapFixture(overrides: Record<string, unknown> = {}) {
	return {
		_id: 'mall-1',
		mapConfig: { threeDObjects: [] }, // ignored by contract
		floors: [
			{
				number: 1,
				snap: encodeURIComponent(svg),
				graph: {
					nodes: ['1-0x0', '1-10x10', '1-20x5'],
					edges: [
						{
							from: '1-0x0',
							to: '1-10x10',
							distance: 14.1,
							d: 'M 0 0 L 10 10',
							fromFloor: 1,
							toFloor: 1,
							bidirectional: true,
							id: 'edge-1'
						}
					]
				},
				graphTranslation: { x: 0, y: 0 },
				portals: [{ id: 'el1', type: 'elevator', fromFloor: 1, toFloors: [2], accessible: true }],
				elements: {
					shop1: { attr: { class: 'object' } },
					el1: { attr: { class: 'elevator' } }
				},
				idToPoints: { shop1: ['1-0x0'], el1: ['1-20x5'] },
				disabled: []
			}
		],
		...overrides
	};
}

describe('decodeSnap', () => {
	it('decodes URL-encoded svg and passes through raw svg', () => {
		expect(decodeSnap(encodeURIComponent(svg))).toBe(svg);
		expect(decodeSnap(svg)).toBe(svg);
	});
});

describe('parseMap (MapV1)', () => {
	it('accepts a valid payload and normalizes it', () => {
		const result = parseMap(mapFixture());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.floors[0].svg).toBe(svg);
		expect(result.data.floors[0].elements.shop1).toEqual({ cls: 'object' });
		expect(result.data.floors[0].idToPoints.shop1).toEqual(['1-0x0']);
	});

	it('rejects schema drift (snap removed)', () => {
		const broken = mapFixture();
		(broken.floors as Record<string, unknown>[])[0].snap = undefined;
		const result = parseMap(broken);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.path).toBe('map');
		expect(result.error.issues.length).toBeGreaterThan(0);
	});

	it('rejects empty floors', () => {
		const result = parseMap(mapFixture({ floors: [] }));
		expect(result.ok).toBe(false);
	});

	it('rejects edges pointing at missing nodes (invariant)', () => {
		const broken = mapFixture();
		(broken.floors as { graph: { edges: { to: string }[] } }[])[0].graph.edges[0].to = '1-99x99';
		const result = parseMap(broken);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.path).toBe('map/invariants');
	});

	it('rejects node ids outside the v1 format (invariant)', () => {
		const broken = mapFixture();
		(broken.floors as { graph: { nodes: string[] } }[])[0].graph.nodes[0] = 'weird-node';
		const result = parseMap(broken);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.path).toBe('map/invariants');
	});

	it('rejects idToPoints refs to missing nodes (invariant)', () => {
		const broken = mapFixture();
		(broken.floors as { idToPoints: Record<string, string[]> }[])[0].idToPoints.shop1 = ['1-404x0'];
		const result = parseMap(broken);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.path).toBe('map/invariants');
	});
});

describe('parseShops (ShopV1)', () => {
	const shop = {
		_id: 'shop1',
		facade: {
			ru: { name: '585 ЗОЛОТОЙ', description: 'Украшения', shortDescription: 'Ювелирные изделия' }
		},
		categories: ['cat1'],
		floor: 1,
		logo: 'https://content.tango.vision/logo.svg',
		color: '#ffdd00',
		isActive: true,
		updatedAt: '2026-10-20T09:05:25.461Z'
	};

	it('parses and normalizes a shop list', () => {
		const result = parseShops([shop]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data[0]).toMatchObject({
			id: 'shop1',
			name: '585 ЗОЛОТОЙ',
			floor: 1,
			categories: ['cat1']
		});
	});

	it('falls back to _id when no facade name', () => {
		const s = normalizeShop({ ...shop, facade: {} });
		expect(s.name).toBe('shop1');
	});

	it('rejects empty shop payloads (invariant)', () => {
		expect(parseShops([]).ok).toBe(false);
	});

	it('rejects records without _id', () => {
		const result = parseShops([{ facade: {} }]);
		expect(result.ok).toBe(false);
	});
});

describe('parseMall (MallV1)', () => {
	it('extracts defaultFloorNumber from settings', () => {
		const result = parseMall({
			_id: 'mall-1',
			name: 'RIO Dmitrovka',
			mallVersion: 7,
			settings: { defaultFloorNumber: 1 }
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.defaultFloorNumber).toBe(1);
		expect(result.data.mallVersion).toBe(7);
	});

	it('normalizes mall.theme brand colors', () => {
		const result = parseMall({
			_id: 'mall-1',
			theme: {
				color1: '#e30a7d',
				map_object_highlight: '#f9c416',
				map_path_arrow: '#0c94d1'
			}
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.theme.primary).toBe('#e30a7d');
		expect(result.data.theme.highlight).toBe('#f9c416');
		expect(result.data.theme.path).toBe('#0c94d1');
	});

	it('rejects payloads without _id', () => {
		expect(parseMall({ name: 'x' }).ok).toBe(false);
	});
});

describe('parseCategories', () => {
	it('normalizes localized names', () => {
		const result = parseCategories([
			{ _id: 'cat1', facade: { ru: { name: 'Ювелирные' } } },
			{ _id: 'cat2', facade: {} }
		]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).toEqual([
			{ id: 'cat1', name: 'Ювелирные' },
			{ id: 'cat2', name: 'cat2' }
		]);
	});
});