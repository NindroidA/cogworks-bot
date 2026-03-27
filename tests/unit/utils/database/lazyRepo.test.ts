/**
 * lazyRepo Unit Tests
 *
 * Tests the lazy repository proxy that defers DataSource access until first use.
 * Since we cannot connect to a real database in unit tests, we focus on:
 * - The proxy object is created and has the expected shape
 * - Accessing methods before DataSource is initialized throws a clear error
 */

import { describe, expect, test } from '@jest/globals';
import { lazyRepo } from '../../../../src/utils/database/lazyRepo';

// Use a minimal fake entity class — lazyRepo accepts any EntityTarget
class FakeEntity {
    id!: number;
    name!: string;
}

describe('lazyRepo()', () => {
    test('returns a non-null object (proxy)', () => {
        const repo = lazyRepo(FakeEntity);
        expect(repo).toBeDefined();
        expect(typeof repo).toBe('object');
    });

    test('throws when accessing methods before DataSource is initialized', () => {
        const repo = lazyRepo(FakeEntity);

        // AppDataSource.getRepository() should throw because DB is not initialized
        expect(() => repo.find()).toThrow();
    });

    test('throws when calling findOne before DataSource is initialized', () => {
        const repo = lazyRepo(FakeEntity);
        expect(() => repo.findOne({ where: {} })).toThrow();
    });

    test('throws when calling findOneBy before DataSource is initialized', () => {
        const repo = lazyRepo(FakeEntity);
        expect(() => repo.findOneBy({})).toThrow();
    });

    test('throws when calling save before DataSource is initialized', () => {
        const repo = lazyRepo(FakeEntity);
        expect(() => repo.save({} as FakeEntity)).toThrow();
    });

    test('throws when calling remove before DataSource is initialized', () => {
        const repo = lazyRepo(FakeEntity);
        expect(() => repo.remove({} as FakeEntity)).toThrow();
    });

    test('throws when calling create before DataSource is initialized', () => {
        const repo = lazyRepo(FakeEntity);
        expect(() => repo.create()). toThrow();
    });

    test('multiple lazyRepo calls return independent proxies', () => {
        const repo1 = lazyRepo(FakeEntity);
        const repo2 = lazyRepo(FakeEntity);
        expect(repo1).not.toBe(repo2);
    });

    test('proxy traps property access (not just method calls)', () => {
        const repo = lazyRepo(FakeEntity);
        // Accessing .metadata should also trigger the proxy and fail
        // because DataSource is not initialized
        expect(() => {
            const _ = repo.metadata;
        }).toThrow();
    });
});
