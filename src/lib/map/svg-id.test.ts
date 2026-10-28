import { describe, expect, it } from 'vitest';
import { classifyHint, isFloorRootId, nodeXY, parseSvgId } from './svg-id.js';

describe('parseSvgId', () => {
	it('parses object groups', () => {
		expect(parseSvgId('abc123(object)')).toEqual({
			entityId: 'abc123',
			hint: 'object'
		});
	});

	it('parses elevator with pipe payload', () => {
		expect(parseSvgId('el4(elevator|1)')).toEqual({
			entityId: 'el4',
			hint: 'elevator'
		});
	});

	it('allows trailing junk after closing paren', () => {
		expect(parseSvgId('deadbeef(toilet)d')).toEqual({
			entityId: 'deadbeef',
			hint: 'toilet'
		});
	});

	it('returns bare id as entity', () => {
		expect(parseSvgId('shape_86')).toEqual({ entityId: 'shape_86', hint: null });
	});
});

describe('classifyHint', () => {
	it('maps object → tenant and amenities → poi', () => {
		expect(classifyHint('object')).toBe('tenant');
		expect(classifyHint('toilet')).toBe('poi');
		expect(classifyHint('elevator')).toBe('poi');
		expect(classifyHint('wall')).toBeNull();
	});
});

describe('nodeXY', () => {
	it('parses positive and negative floors', () => {
		expect(nodeXY('1-120.5x80')).toEqual({ x: 120.5, y: 80 });
		expect(nodeXY('-2-10x20')).toEqual({ x: 10, y: 20 });
	});
});

describe('isFloorRootId', () => {
	it('detects floor wrappers', () => {
		expect(isFloorRootId('floor 1')).toBe(true);
		expect(isFloorRootId('floor -2')).toBe(true);
		expect(isFloorRootId('objects')).toBe(false);
	});
});
