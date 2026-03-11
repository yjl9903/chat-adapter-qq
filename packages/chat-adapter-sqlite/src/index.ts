import Database from 'better-sqlite3';
import { type Lock, type Logger, type StateAdapter, ConsoleLogger } from 'chat';

export type SqliteDatabaseClient = Database.Database;

export interface SqliteStateAdapterOptions {
  keyPrefix?: string;
  logger?: Logger;
  path: string;
}

export interface SqliteStateClientOptions {
  client: SqliteDatabaseClient;
  keyPrefix?: string;
  logger?: Logger;
}

export type CreateSqliteStateOptions =
  | (Partial<SqliteStateAdapterOptions> & {
      client?: never;
    })
  | (Partial<Omit<SqliteStateClientOptions, 'client'>> & {
      client: SqliteDatabaseClient;
    });

interface LockRow {
  expires_at: number;
  token: string;
}

interface CacheRow {
  expires_at: number | null;
  value: string | null;
}

interface CountRow {
  count: number;
}

interface ListRow {
  seq: number;
  value: string | null;
}

export class SqliteStateAdapter implements StateAdapter {
  private db?: SqliteDatabaseClient;

  private readonly dbPath?: string;

  private readonly keyPrefix: string;

  private readonly logger: Logger;

  private readonly ownsClient: boolean;

  private connected = false;

  constructor(options: SqliteStateAdapterOptions | SqliteStateClientOptions) {
    if ('client' in options) {
      this.db = options.client;
      this.ownsClient = false;
    } else {
      this.dbPath = options.path;
      this.ownsClient = true;
    }

    this.keyPrefix = options.keyPrefix || 'chat-sdk';
    this.logger = options.logger ?? new ConsoleLogger('info').child('sqlite');
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    let createdClient = false;

    try {
      if (!this.db) {
        if (!this.dbPath) {
          throw new Error('Sqlite path is required to create a database client.');
        }

        this.db = new Database(this.dbPath);
        createdClient = true;
      }

      this.getDb().prepare('SELECT 1').get();
      this.ensureSchema();

      this.connected = true;
    } catch (error) {
      if (createdClient && this.db) {
        try {
          this.db.close();
        } catch {
          // Best effort cleanup for partially-initialized owned clients.
        }
        this.db = undefined;
      }

      this.logger.error('SQLite connect failed', { error });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    if (this.ownsClient && this.db) {
      this.db.close();
      this.db = undefined;
    }

    this.connected = false;
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    this.getDb()
      .prepare(
        `INSERT OR IGNORE INTO chat_state_subscriptions (key_prefix, thread_id)
         VALUES (?, ?)`
      )
      .run(this.keyPrefix, threadId);
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    this.getDb()
      .prepare(
        `DELETE FROM chat_state_subscriptions
         WHERE key_prefix = ? AND thread_id = ?`
      )
      .run(this.keyPrefix, threadId);
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();
    const row = this.getDb()
      .prepare<[string, string], { thread_id: string }>(
        `SELECT thread_id FROM chat_state_subscriptions
         WHERE key_prefix = ? AND thread_id = ?
         LIMIT 1`
      )
      .get(this.keyPrefix, threadId);

    return row !== undefined;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();

    return this.withImmediateTransaction(() => {
      const db = this.getDb();
      const now = Date.now();
      const existing = db
        .prepare<[string, string], LockRow>(
          `SELECT token, expires_at FROM chat_state_locks
           WHERE key_prefix = ? AND thread_id = ?
           LIMIT 1`
        )
        .get(this.keyPrefix, threadId);

      if (existing && existing.expires_at > now) {
        return null;
      }

      if (existing) {
        db.prepare(
          `DELETE FROM chat_state_locks
           WHERE key_prefix = ? AND thread_id = ?`
        ).run(this.keyPrefix, threadId);
      }

      const lock: Lock = {
        threadId,
        token: generateToken(),
        expiresAt: now + ttlMs
      };

      db.prepare(
        `INSERT INTO chat_state_locks (key_prefix, thread_id, token, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(this.keyPrefix, threadId, lock.token, lock.expiresAt, now);

      return lock;
    });
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.ensureConnected();
    this.getDb()
      .prepare(
        `DELETE FROM chat_state_locks
         WHERE key_prefix = ? AND thread_id = ?`
      )
      .run(this.keyPrefix, threadId);
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();
    this.getDb()
      .prepare(
        `DELETE FROM chat_state_locks
         WHERE key_prefix = ? AND thread_id = ? AND token = ?`
      )
      .run(this.keyPrefix, lock.threadId, lock.token);
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();

    const now = Date.now();
    const result = this.getDb()
      .prepare(
        `UPDATE chat_state_locks
         SET expires_at = ?, updated_at = ?
         WHERE key_prefix = ?
           AND thread_id = ?
           AND token = ?
           AND expires_at > ?`
      )
      .run(now + ttlMs, now, this.keyPrefix, lock.threadId, lock.token, now);

    return Number(result.changes) > 0;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureConnected();

    const db = this.getDb();
    const row = db
      .prepare<[string, string], CacheRow>(
        `SELECT value, expires_at FROM chat_state_cache
         WHERE key_prefix = ? AND cache_key = ?
         LIMIT 1`
      )
      .get(this.keyPrefix, key);

    if (!row) {
      return null;
    }

    if (isExpired(row.expires_at)) {
      db.prepare(
        `DELETE FROM chat_state_cache
         WHERE key_prefix = ? AND cache_key = ?`
      ).run(this.keyPrefix, key);
      return null;
    }

    return deserializeValue<T>(row.value);
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.ensureConnected();

    const now = Date.now();
    const expiresAt = ttlMs ? now + ttlMs : null;
    this.getDb()
      .prepare(
        `INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key_prefix, cache_key) DO UPDATE SET
           value = excluded.value,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`
      )
      .run(this.keyPrefix, key, serializeValue(value), expiresAt, now);
  }

  async setIfNotExists(key: string, value: unknown, ttlMs?: number): Promise<boolean> {
    this.ensureConnected();

    return this.withImmediateTransaction(() => {
      const db = this.getDb();
      const existing = db
        .prepare<[string, string], CacheRow>(
          `SELECT expires_at, value FROM chat_state_cache
           WHERE key_prefix = ? AND cache_key = ?
           LIMIT 1`
        )
        .get(this.keyPrefix, key);

      if (existing) {
        if (isExpired(existing.expires_at)) {
          db.prepare(
            `DELETE FROM chat_state_cache
             WHERE key_prefix = ? AND cache_key = ?`
          ).run(this.keyPrefix, key);
        } else {
          return false;
        }
      }

      const now = Date.now();
      const expiresAt = ttlMs ? now + ttlMs : null;
      db.prepare(
        `INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(this.keyPrefix, key, serializeValue(value), expiresAt, now);

      return true;
    });
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();
    this.getDb()
      .prepare(
        `DELETE FROM chat_state_cache
         WHERE key_prefix = ? AND cache_key = ?`
      )
      .run(this.keyPrefix, key);
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: {
      maxLength?: number;
      ttlMs?: number;
    }
  ): Promise<void> {
    this.ensureConnected();

    this.withImmediateTransaction(() => {
      const db = this.getDb();
      const now = Date.now();
      const expiresAt = options?.ttlMs ? now + options.ttlMs : null;

      db.prepare(
        `DELETE FROM chat_state_lists
         WHERE key_prefix = ? AND list_key = ? AND expires_at IS NOT NULL AND expires_at <= ?`
      ).run(this.keyPrefix, key, now);

      db.prepare(
        `INSERT INTO chat_state_lists (key_prefix, list_key, value, expires_at)
         VALUES (?, ?, ?, ?)`
      ).run(this.keyPrefix, key, serializeValue(value), expiresAt);

      db.prepare(
        `UPDATE chat_state_lists
         SET expires_at = ?
         WHERE key_prefix = ? AND list_key = ?`
      ).run(expiresAt, this.keyPrefix, key);

      if (options?.maxLength) {
        const count = db
          .prepare<[string, string], CountRow>(
            `SELECT COUNT(*) AS count FROM chat_state_lists
             WHERE key_prefix = ? AND list_key = ?`
          )
          .get(this.keyPrefix, key)?.count;

        const overflow = (count ?? 0) - options.maxLength;
        if (overflow > 0) {
          db.prepare(
            `DELETE FROM chat_state_lists
             WHERE seq IN (
               SELECT seq FROM chat_state_lists
               WHERE key_prefix = ? AND list_key = ?
               ORDER BY seq ASC
               LIMIT ?
             )`
          ).run(this.keyPrefix, key, overflow);
        }
      }
    });
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    this.ensureConnected();

    const db = this.getDb();
    const now = Date.now();
    db.prepare(
      `DELETE FROM chat_state_lists
       WHERE key_prefix = ? AND list_key = ? AND expires_at IS NOT NULL AND expires_at <= ?`
    ).run(this.keyPrefix, key, now);

    const rows = db
      .prepare<[string, string], ListRow>(
        `SELECT seq, value FROM chat_state_lists
         WHERE key_prefix = ? AND list_key = ?
         ORDER BY seq ASC`
      )
      .all(this.keyPrefix, key);

    return rows.map((row) => deserializeValue<T>(row.value));
  }

  getClient(): SqliteDatabaseClient {
    this.ensureConnected();
    return this.getDb();
  }

  private ensureSchema(): void {
    this.getDb().exec(`
      CREATE TABLE IF NOT EXISTS chat_state_subscriptions (
        key_prefix TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        PRIMARY KEY (key_prefix, thread_id)
      );

      CREATE TABLE IF NOT EXISTS chat_state_locks (
        key_prefix TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (key_prefix, thread_id)
      );

      CREATE INDEX IF NOT EXISTS chat_state_locks_expires_idx
      ON chat_state_locks (expires_at);

      CREATE TABLE IF NOT EXISTS chat_state_cache (
        key_prefix TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (key_prefix, cache_key)
      );

      CREATE INDEX IF NOT EXISTS chat_state_cache_expires_idx
      ON chat_state_cache (expires_at);

      CREATE TABLE IF NOT EXISTS chat_state_lists (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        key_prefix TEXT NOT NULL,
        list_key TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS chat_state_lists_lookup_idx
      ON chat_state_lists (key_prefix, list_key, seq);

      CREATE INDEX IF NOT EXISTS chat_state_lists_expires_idx
      ON chat_state_lists (expires_at);
    `);
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('SqliteStateAdapter is not connected. Call connect() first.');
    }
  }

  private getDb(): SqliteDatabaseClient {
    if (!this.db) {
      throw new Error('SqliteStateAdapter database client is not initialized.');
    }

    return this.db;
  }

  private withImmediateTransaction<T>(callback: () => T): T {
    const db = this.getDb();
    return db.transaction(callback).immediate();
  }
}

export function createSqliteState(options: CreateSqliteStateOptions = {}): SqliteStateAdapter {
  if ('client' in options && options.client) {
    return new SqliteStateAdapter({
      client: options.client,
      keyPrefix: options.keyPrefix,
      logger: options.logger
    });
  }

  const path = options.path || process.env.SQLITE_PATH;
  if (!path) {
    throw new Error('Sqlite path is required. Set SQLITE_PATH or provide it in options.');
  }

  return new SqliteStateAdapter({
    path,
    keyPrefix: options.keyPrefix,
    logger: options.logger
  });
}

function generateToken(): string {
  return `sqlite_${crypto.randomUUID()}`;
}

function serializeValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized ?? 'null';
}

function deserializeValue<T>(value: string | null): T {
  if (value === null) {
    return null as T;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return value as T;
  }
}

function isExpired(expiresAt: number | null): boolean {
  return expiresAt !== null && expiresAt <= Date.now();
}
