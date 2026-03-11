# chat-adapter-sqlite

[![npm version](https://img.shields.io/npm/v/chat-adapter-sqlite)](https://www.npmjs.com/package/chat-adapter-sqlite)
[![npm downloads](https://img.shields.io/npm/dm/chat-adapter-sqlite)](https://www.npmjs.com/package/chat-adapter-sqlite)
[![CI](https://github.com/yjl9903/chat-adapter-qq/actions/workflows/ci.yml/badge.svg)](https://github.com/yjl9903/chat-adapter-qq/actions/workflows/ci.yml)

SQLite state adapter for [Chat SDK](https://chat-sdk.dev/docs) built with [better-sqlite3](https://github.com/WiseLibs/better-sqlite3). Use this when SQLite is your primary datastore and you want local persistent state without Redis or Postgres.

## Installation

```bash
pnpm add chat chat-adapter-sqlite better-sqlite3
```

## Usage

`createSqliteState()` auto-detects `SQLITE_PATH`, so you can call it with no arguments:

```ts
import { Chat } from 'chat';
import { createSqliteState } from 'chat-adapter-sqlite';

const bot = new Chat({
  userName: 'mybot',
  adapters: {
    // ...
  },
  state: createSqliteState()
});
```

To provide a path explicitly:

```ts
const state = createSqliteState({
  path: './data/chat-state.db'
});
```

### Using an existing client

```ts
import Database from 'better-sqlite3';

const client = new Database('./data/chat-state.db');
const state = createSqliteState({ client });
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `path` | No* | SQLite database path |
| `client` | No | Existing `better-sqlite3` database instance |
| `keyPrefix` | No | Prefix for all state rows (default: `"chat-sdk"`) |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info").child("sqlite")`) |

*Either `path`, `SQLITE_PATH`, or `client` is required.

## Environment variables

```bash
SQLITE_PATH=./data/chat-state.db
```

## Data model

The adapter creates these tables automatically on `connect()`:

```sql
chat_state_subscriptions
chat_state_locks
chat_state_cache
chat_state_lists
```

All rows are namespaced by `key_prefix`.

## Features

| Feature | Supported |
|---------|-----------|
| Persistence | Yes |
| Single-host multi-process | Yes |
| Subscriptions | Yes |
| Locking | Yes |
| Key-value caching | Yes (with TTL) |
| List caching | Yes (with TTL and max length) |
| Automatic table creation | Yes |
| Key prefix namespacing | Yes |

## Locking considerations

SQLite locking works well when your app instances share the same database file on one host. It is not a replacement for Redis-style distributed locking across multiple machines.

## Expired row cleanup

SQLite does not automatically delete expired rows. The adapter performs opportunistic cleanup:

- expired locks are replaced during `acquireLock()`
- expired cache entries are removed during `get()` and `setIfNotExists()`
- expired list items are removed during `appendToList()` and `getList()`

## License

MIT License © 2026 [XLor](https://github.com/yjl9903)
