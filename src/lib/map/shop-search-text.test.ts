import { describe, expect, it } from 'vitest';
import {
	buildShopSearchFields,
	buildShopSearchName,
	buildShopSearchTagsText,
	buildShopSearchText,
	normalizeSearchTags
} from './shop-search-text.js';

describe('normalizeSearchTags', () => {
	it('handles null/undefined/empty', () => {
		expect(normalizeSearchTags(null)).toBe('');
		expect(normalizeSearchTags(undefined)).toBe('');
		expect(normalizeSearchTags('')).toBe('');
		expect(normalizeSearchTags('   ')).toBe('');
	});

	it('keeps strings', () => {
		expect(normalizeSearchTags('cafe, coffee')).toBe('cafe, coffee');
	});

	it('joins arrays and drops empties', () => {
		expect(normalizeSearchTags(['a', null, 'b', ''])).toBe('a b');
	});

	it('stringifies other types', () => {
		expect(normalizeSearchTags(42)).toBe('42');
	});
});

describe('buildShopSearchFields', () => {
	it('splits name and tags', () => {
		expect(
			buildShopSearchFields({
				name: 'ДЕТСКИЙ МИР',
				roomNumber: 'A1',
				searchTags: 'детская, игрушки'
			})
		).toEqual({
			searchName: 'ДЕТСКИЙ МИР A1',
			searchTagsText: 'детская, игрушки',
			searchText: 'ДЕТСКИЙ МИР A1 детская, игрушки'
		});
	});

	it('works when searchTags empty/null', () => {
		expect(buildShopSearchFields({ name: 'Only Name', searchTags: null })).toEqual({
			searchName: 'Only Name',
			searchTagsText: '',
			searchText: 'Only Name'
		});
		expect(buildShopSearchName({ name: 'Only Name' })).toBe('Only Name');
		expect(buildShopSearchTagsText({ searchTags: '' })).toBe('');
	});

	it('accepts array tags', () => {
		expect(buildShopSearchFields({ name: 'X', searchTags: ['a', 'b'] })).toEqual({
			searchName: 'X',
			searchTagsText: 'a b',
			searchText: 'X a b'
		});
	});

	it('buildShopSearchText still joins all parts', () => {
		expect(
			buildShopSearchText({
				name: 'Sportmaster',
				roomNumber: 'A1',
				searchTags: 'sport, shoes'
			})
		).toBe('Sportmaster A1 sport, shoes');
	});
});
