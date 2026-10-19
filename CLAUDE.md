# Abstrabit Console Backend

Node.js 24, Express 5, JavaScript ES modules, Drizzle + pg (Supabase transaction pooler), zod, pino, Vitest + supertest.
Deployed as its own Vercel project. The HTTP API under /api is the contract with the frontend.

## Code style

- JavaScript ES modules with .js extensions on relative imports.
- Source files are comment-free and self-explanatory; scripts/check-no-comments.js runs in npm run lint.
- Professional wording in code, logs, errors and commit messages.
- Feature modules in src/modules/<feature>/: routes, controller (thin), service (logic and data access), schema (zod).
- Shared plumbing in src/config, src/common, src/db, src/middleware, src/utils.
- zod validates bodies, params, queries, environment variables and external responses.
- Errors are AppError subclasses; responses use { error: { code, message, fields? } }.
- Tests in tests/: unit mirrors src, integration uses supertest against src/app.js, helpers hold fixtures.

## Invariants

- /api/discord/interactions is mounted before express.json() and uses express.raw(); verifyKey is awaited.
- Timestamps are accepted within 300 s; interactions are deduplicated with INSERT … ON CONFLICT DO NOTHING.
- The interaction route verifies, records and acknowledges; side effects run as jobs through background().
- Jobs run after claimJobs() and complete through the lease_token check; inline work is 2 attempts within ~15 s.
- process creates child jobs in the same transaction as the decision.
- Message-creating retries after an unknown outcome reconcile first.
- src/app.js exports the app; src/server.js listens locally.
- Configuration comes from src/config/env.js; durable state lives in Postgres.
- Discord payloads set allowed_mentions: { parse: [] }.
- Logs and stored errors pass through scrub(); outbound errors carry route templates, never URLs.
- Admin queries are scoped through admin_guilds; data queries filter by guild_id.
- Admin auth is a server-side session (express-session + connect-pg-simple) in an HttpOnly __Host-sid cookie.

## Commands

npm run dev · npm test (after npm run test:db) · npm run lint · npm run format · npm run db:generate · npm run db:migrate · npm run seed:admin · npm run register:commands
