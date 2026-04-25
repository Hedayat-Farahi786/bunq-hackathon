# Aether memory + cache — database layer

## How it works

- **Driver-agnostic.** `server/db/index.js` exposes a single API (`many / one / exec / transaction`) over either SQLite (local) or MariaDB/MySQL (prod).
- **Schema is portable ANSI SQL.** Files in `migrations/*.sql` run unchanged on both engines. The tiny dialect differences (e.g. `ON CONFLICT … DO UPDATE` → `ON DUPLICATE KEY UPDATE`) are rewritten at runtime inside `prepMariaSQL()`.
- **Migrations are forward-only + idempotent.** `runMigrations()` tracks applied files in `schema_migrations` and skips any already there.

## Local (default)

Nothing to configure. Boot the server and you'll see:

```
[db] mode=sqlite · migrations=1 applied
```

The DB lives at `./server/data/aether.db` (gitignored). Delete it to reset.

## AWS RDS MariaDB

1. Create a MariaDB RDS instance (the smallest burstable tier is plenty for hackathon/demo).
2. Create a database + user:

   ```sql
   CREATE DATABASE aether CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'aether'@'%' IDENTIFIED BY 'STRONG_PASSWORD';
   GRANT ALL PRIVILEGES ON aether.* TO 'aether'@'%';
   FLUSH PRIVILEGES;
   ```

3. In `.env`:

   ```
   DATABASE_URL=mysql://aether:STRONG_PASSWORD@your-rds.xxx.eu-west-1.rds.amazonaws.com:3306/aether
   DB_SSL=true
   ```

4. Restart. You'll see:

   ```
   [db] mode=mariadb · migrations=1 applied
   ```

That's it. No code change.

## Tables

| Table                  | Purpose                                                                   |
|------------------------|---------------------------------------------------------------------------|
| `conversations`        | Every AI turn (input, output, latency, cache hit, tokens)                 |
| `conversation_actions` | The actions the AI suggested in each turn (for accept-rate tracking)      |
| `action_log`           | Every action actually dispatched, with snapshot + idempotency key         |
| `user_traits`          | Learned preferences (`amount_pref_transfer=smaller_than_suggested`, …)    |
| `merchant_memory`      | User corrections for merchant category/recurrence                         |
| `ai_cache`             | L2 response cache (key = SHA-256 of provider+user+message+image+context)  |
| `schema_migrations`    | Bookkeeping: which .sql files have been applied                           |

## Cache

Two-tier: in-process LRU (500 entries, ~5 min TTL) + persisted `ai_cache` table.

- Identical requests inside 5 min hit L1 in sub-ms.
- Across restarts / across nodes, L2 serves the same response.
- Mutating responses (TRANSFER, BLOCK_CARD, …) and HIGH-risk scenes are never cached.
- Stampede protection: N identical in-flight calls deduplicate to 1 upstream request.

## Observability

`GET /api/health` and `GET /api/memory/stats` expose:

- DB mode + connected
- L1/L2 hit counts, hit rate, pending dedup count
- Number of conversations, actions (completed vs total), traits, merchants, cache entries
