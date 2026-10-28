import { describe, expect, it } from 'vitest';
import { recordId, recordKey } from './surreal-id.js';

describe('recordKey', () => {
	it('strips table prefix', () => {
		expect(recordKey('shop_cache:6839b4e7eb1a33f8bc2a25db', 'shop_cache')).toBe(
			'6839b4e7eb1a33f8bc2a25db'
		);
	});

	it('strips angle brackets', () => {
		expect(recordKey('shop_cache:⟨abc⟩', 'shop_cache')).toBe('abc');
	});

	it('passes bare keys through', () => {
		expect(recordKey('6839b4e7eb1a33f8bc2a25db', 'shop_cache')).toBe(
			'6839b4e7eb1a33f8bc2a25db'
		);
	});

	it('handles object form', () => {
		expect(recordKey({ tb: 'shop_cache', id: 'abc' }, 'shop_cache')).toBe('abc');
	});

	it('strips any table when table omitted', () => {
		expect(recordKey('mall_cache:6804d32a')).toBe('6804d32a');
	});
});

describe('recordId', () => {
	it('formats table:key', () => {
		expect(recordId('shop_cache', 'abc')).toBe('shop_cache:abc');
	});
});
