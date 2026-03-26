import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { QueueEntry } from 'chat';
import {
  createSqliteState,
  type SqliteDatabaseClient,
  type SqliteStateAdapter
} from '../src/index.js';

function createClient(path = ':memory:'): SqliteDatabaseClient {
  return new Database(path);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const cleanupTasks: Array<() => void> = [];

afterEach(() => {
  while (cleanupTasks.length > 0) {
    const task = cleanupTasks.pop();
    task?.();
  }
});

function trackAdapter(adapter: SqliteStateAdapter): SqliteStateAdapter {
  cleanupTasks.push(() => {
    void adapter.disconnect();
  });
  return adapter;
}

function trackClient(client: SqliteDatabaseClient): SqliteDatabaseClient {
  cleanupTasks.push(() => {
    try {
      client.close();
    } catch {
      // Client may already be closed by owned-adapter disconnect.
    }
  });
  return client;
}

function createQueueEntry(id: string, enqueuedAt = Date.now()): QueueEntry {
  return {
    enqueuedAt,
    expiresAt: enqueuedAt + 60_000,
    message: {
      id,
      text: `message:${id}`
    } as QueueEntry['message']
  };
}

describe('createSqliteState', () => {
  it('throws when path and env are missing', () => {
    delete process.env.SQLITE_PATH;
    expect(() => createSqliteState()).toThrow(/SQLITE_PATH/);
  });

  it('uses SQLITE_PATH by default', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chat-adapter-sqlite-'));
    cleanupTasks.push(() => rmSync(dir, { force: true, recursive: true }));

    process.env.SQLITE_PATH = join(dir, 'state.db');
    const adapter = trackAdapter(createSqliteState());

    await adapter.connect();
    await adapter.set('env-key', { ok: true });

    expect(await adapter.get('env-key')).toEqual({ ok: true });
    delete process.env.SQLITE_PATH;
  });
});

describe('SqliteStateAdapter lifecycle', () => {
  it('requires connect before use', async () => {
    const client = trackClient(createClient());
    const adapter = createSqliteState({ client });

    await expect(adapter.get('missing')).rejects.toThrow(/Call connect/);
  });

  it('does not close injected clients on disconnect', async () => {
    const client = trackClient(createClient());
    const adapter = trackAdapter(createSqliteState({ client }));

    await adapter.connect();
    await adapter.disconnect();

    expect(() => client.prepare('SELECT 1').get()).not.toThrow();
  });

  it('persists data across owned path-based reconnects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chat-adapter-sqlite-'));
    cleanupTasks.push(() => rmSync(dir, { force: true, recursive: true }));
    const path = join(dir, 'state.db');

    const first = trackAdapter(createSqliteState({ path }));
    await first.connect();
    await first.subscribe('thread-1');
    await first.disconnect();

    const second = trackAdapter(createSqliteState({ path }));
    await second.connect();

    expect(await second.isSubscribed('thread-1')).toBe(true);
  });
});

describe('subscriptions', () => {
  it('subscribes and unsubscribes threads', async () => {
    const adapter = trackAdapter(createSqliteState({ client: trackClient(createClient()) }));
    await adapter.connect();

    expect(await adapter.isSubscribed('thread-1')).toBe(false);

    await adapter.subscribe('thread-1');
    expect(await adapter.isSubscribed('thread-1')).toBe(true);

    await adapter.unsubscribe('thread-1');
    expect(await adapter.isSubscribed('thread-1')).toBe(false);
  });
});

describe('locks', () => {
  it('acquires, conflicts, releases, and force releases locks', async () => {
    const adapter = trackAdapter(createSqliteState({ client: trackClient(createClient()) }));
    await adapter.connect();

    const lock = await adapter.acquireLock('thread-1', 1_000);
    expect(lock).not.toBeNull();

    expect(await adapter.acquireLock('thread-1', 1_000)).toBeNull();

    await adapter.releaseLock(lock!);
    expect(await adapter.acquireLock('thread-1', 1_000)).not.toBeNull();

    await adapter.forceReleaseLock('thread-1');
    expect(await adapter.acquireLock('thread-1', 1_000)).not.toBeNull();
  });

  it('allows takeover after lock expiry', async () => {
    const adapter = trackAdapter(createSqliteState({ client: trackClient(createClient()) }));
    await adapter.connect();

    const first = await adapter.acquireLock('thread-1', 20);
    expect(first).not.toBeNull();

    await wait(30);

    const second = await adapter.acquireLock('thread-1', 1_000);
    expect(second).not.toBeNull();
    expect(second?.token).not.toEqual(first?.token);
  });

  it('extends only active matching locks', async () => {
    const adapter = trackAdapter(createSqliteState({ client: trackClient(createClient()) }));
    await adapter.connect();

    const lock = await adapter.acquireLock('thread-1', 20);
    expect(lock).not.toBeNull();

    expect(await adapter.extendLock(lock!, 100)).toBe(true);
    expect(await adapter.extendLock({ ...lock!, token: 'other-token' }, 100)).toBe(false);

    await wait(130);
    expect(await adapter.extendLock(lock!, 100)).toBe(false);
  });
});

describe('cache', () => {
  it('stores and deletes values', async () => {
    const adapter = trackAdapter(createSqliteState({ client: trackClient(createClient()) }));
    await adapter.connect();

    await adapter.set('user', { id: 1, tags: ['a'] });
    expect(await adapter.get('user')).toEqual({ id: 1, tags: ['a'] });

    await adapter.delete('user');
    expect(await adapter.get('user')).toBeNull();
  });

  it('expires TTL values and allows setIfNotExists after expiry', async () => {
    const adapter = trackAdapter(createSqliteState({ client: trackClient(createClient()) }));
    await adapter.connect();

    await adapter.set('ephemeral', 'value', 20);
    expect(await adapter.get('ephemeral')).toEqual('value');

    await wait(30);
    expect(await adapter.get('ephemeral')).toBeNull();

    expect(await adapter.setIfNotExists('ephemeral', 'next', 20)).toBe(true);
    expect(await adapter.setIfNotExists('ephemeral', 'later', 20)).toBe(false);
  });
});

describe('lists', () => {
  it('appends in order and trims to maxLength', async () => {
    const adapter = trackAdapter(createSqliteState({ client: trackClient(createClient()) }));
    await adapter.connect();

    await adapter.appendToList('events', 'a');
    await adapter.appendToList('events', 'b');
    await adapter.appendToList('events', 'c', { maxLength: 2 });

    expect(await adapter.getList('events')).toEqual(['b', 'c']);
  });

  it('expires lists and refreshes TTL for the whole list', async () => {
    const adapter = trackAdapter(createSqliteState({ client: trackClient(createClient()) }));
    await adapter.connect();

    await adapter.appendToList('events', 'a', { ttlMs: 25 });
    await wait(15);
    await adapter.appendToList('events', 'b', { ttlMs: 40 });
    await wait(20);

    expect(await adapter.getList('events')).toEqual(['a', 'b']);

    await wait(30);
    expect(await adapter.getList('events')).toEqual([]);
  });
});

describe('queue', () => {
  it('enqueues and dequeues entries in FIFO order', async () => {
    const adapter = trackAdapter(createSqliteState({ client: trackClient(createClient()) }));
    await adapter.connect();

    const first = createQueueEntry('a', 1_000);
    const second = createQueueEntry('b', 2_000);

    expect(await adapter.enqueue('thread-1', first, 10)).toBe(1);
    expect(await adapter.enqueue('thread-1', second, 10)).toBe(2);
    expect(await adapter.queueDepth('thread-1')).toBe(2);

    expect(await adapter.dequeue('thread-1')).toEqual(first);
    expect(await adapter.dequeue('thread-1')).toEqual(second);
    expect(await adapter.dequeue('thread-1')).toBeNull();
    expect(await adapter.queueDepth('thread-1')).toBe(0);
  });

  it('trims the oldest entries when maxSize is exceeded', async () => {
    const adapter = trackAdapter(createSqliteState({ client: trackClient(createClient()) }));
    await adapter.connect();

    await adapter.enqueue('thread-1', createQueueEntry('a', 1_000), 2);
    await adapter.enqueue('thread-1', createQueueEntry('b', 2_000), 2);

    expect(await adapter.enqueue('thread-1', createQueueEntry('c', 3_000), 2)).toBe(2);
    expect(await adapter.queueDepth('thread-1')).toBe(2);

    expect((await adapter.dequeue('thread-1'))?.message.id).toBe('b');
    expect((await adapter.dequeue('thread-1'))?.message.id).toBe('c');
  });
});

describe('keyPrefix isolation', () => {
  it('isolates cache, subscriptions, and queues for shared clients', async () => {
    const client = trackClient(createClient());
    const first = trackAdapter(createSqliteState({ client, keyPrefix: 'first' }));
    const second = trackAdapter(createSqliteState({ client, keyPrefix: 'second' }));

    await first.connect();
    await second.connect();

    await first.set('shared-key', 'first-value');
    await second.set('shared-key', 'second-value');
    await first.subscribe('thread-1');
    await first.enqueue('thread-1', createQueueEntry('first'), 10);
    await second.enqueue('thread-1', createQueueEntry('second'), 10);

    expect(await first.get('shared-key')).toEqual('first-value');
    expect(await second.get('shared-key')).toEqual('second-value');
    expect(await second.isSubscribed('thread-1')).toBe(false);
    expect((await first.dequeue('thread-1'))?.message.id).toBe('first');
    expect((await second.dequeue('thread-1'))?.message.id).toBe('second');
  });
});
