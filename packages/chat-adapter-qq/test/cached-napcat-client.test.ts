import { describe, expect, it } from 'vitest';
import { LRUCache } from 'lru-cache';

import { createAsyncMemoFactory } from '../src/napcat/cached-client.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('createAsyncMemoFactory', () => {
  it('reuses cached value for same key', async () => {
    const cache = new LRUCache<string, any>({ max: 100 });
    const memoizeAsync = createAsyncMemoFactory(cache);

    let calls = 0;
    const fn = memoizeAsync({
      key: (id: number) => `key:${id}`,
      ttl: 1000,
      fn: async (id: number) => {
        calls += 1;
        return { id, calls };
      }
    });

    const first = await fn(1);
    const second = await fn(1);

    expect(first).toEqual(second);
    expect(calls).toBe(1);
  });

  it('deduplicates concurrent requests for same key', async () => {
    const cache = new LRUCache<string, any>({ max: 100 });
    const memoizeAsync = createAsyncMemoFactory(cache);

    let calls = 0;
    const fn = memoizeAsync({
      key: (id: number) => `key:${id}`,
      ttl: 1000,
      fn: async (id: number) => {
        calls += 1;
        await sleep(20);
        return { id, calls };
      }
    });

    const [a, b] = await Promise.all([fn(1), fn(1)]);

    expect(a).toEqual(b);
    expect(calls).toBe(1);
  });

  it('refreshes value after ttl expires', async () => {
    const cache = new LRUCache<string, any>({ max: 100 });
    const memoizeAsync = createAsyncMemoFactory(cache);

    let calls = 0;
    const fn = memoizeAsync({
      key: (id: number) => `key:${id}`,
      ttl: 20,
      fn: async (id: number) => {
        calls += 1;
        return { id, calls };
      }
    });

    await fn(1);
    await sleep(30);
    const refreshed = await fn(1);

    expect(refreshed).toEqual({ id: 1, calls: 2 });
    expect(calls).toBe(2);
  });

  it('supports explicit invalidate', async () => {
    const cache = new LRUCache<string, any>({ max: 100 });
    const memoizeAsync = createAsyncMemoFactory(cache);

    let calls = 0;
    const fn = memoizeAsync({
      key: (id: number) => `key:${id}`,
      ttl: 1000,
      fn: async (id: number) => {
        calls += 1;
        return { id, calls };
      }
    });

    await fn(1);
    fn.invalidate(1);
    const afterInvalidate = await fn(1);
    expect(afterInvalidate).toEqual({ id: 1, calls: 2 });
  });
});
