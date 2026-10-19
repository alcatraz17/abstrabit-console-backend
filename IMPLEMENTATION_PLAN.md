# Implementation Plan: Abstrabit Console Backend

The backend for the Discord slash-command bot. It serves the Discord interactions endpoint, runs every side effect as a persisted job with retries, and exposes the admin API used by the console in `abstrabit-console-frontend`. The HTTP API under `/api` is the contract between the two projects.

## Stack

- Node.js 24, Express 5, JavaScript ES modules
- PostgreSQL on Supabase through the transaction pooler, Drizzle ORM and `pg`
- zod for environment variables, request input and external responses
- `express-session` with `connect-pg-simple`, passwords hashed with `bcryptjs`
- pino with secret scrubbing on every log line and stored error
- `discord-interactions` for Ed25519 verification, Discord REST with the bot token
- Groq chat completions in JSON mode for report summaries and tags
- Vercel Hobby in `icn1`, a Cloudflare Worker cron for the per-minute sweep
- Vitest and supertest against PostgreSQL 17 in Docker

## Request flow

1. Discord sends each interaction to `POST /api/discord/interactions`. The raw body is verified with Ed25519 and the timestamp must be within 300 seconds.
2. `PING` is answered with `PONG`. Every other interaction is recorded once, keyed on its id, together with a `process` job, inside a 1.5 second budget.
3. The initial response goes out within Discord's 3-second window: deferred for `/report`, a modal when `/report` has no text, inline for `/status` and `/connect`, and a deferred update for buttons.
4. `process` evaluates the rules, asks the AI for a summary and creates the child jobs (`discord_reply`, `channel_post`, `mirror`, `ai_enrich`) in one transaction.
5. Jobs run inline twice within about 15 seconds, then through the sweeper at roughly +1, +2, +4, +8 and +10 minutes, up to 8 attempts. Failed jobs stay visible in the console and can be retried.

## Progress

### 1. Foundation

- [x] Project setup: ESLint, Prettier, Vitest, comment check and the CI workflow
- [x] Validated environment, domain constants, logger with secret scrubbing and AES-256-GCM helpers
- [x] Drizzle schema and initial migration: admins, sessions, servers, command configuration, interactions, reports, jobs, job attempts and events
- [x] Express app with helmet, request logging, body limits, session store, origin check and JSON errors
- [x] Health endpoint with database status, due jobs and the last sweep

### 2. Admin authentication

- [x] Login, logout and `/me` with server-side sessions in an HttpOnly cookie
- [x] 30-minute idle timeout, 8-hour absolute limit and a new session id on every sign-in
- [x] Sign-in rate limits per email and per IP, with failed attempts recorded as security events
- [x] `seed:admin` script for creating and resetting console accounts

### 3. Commands and Discord

- [x] Rule engine: ordered keyword rules, severity filters, mirror policy and per-user cooldown
- [x] Default configuration for `/report` and `/status` on every connected server
- [x] Discord REST client with timeouts, route-template errors and permanent error codes
- [x] Command definitions for `/report`, `/status` and `/connect`, and the `register:commands` script
- [x] Message, card and modal builders with mentions disabled and Discord length limits applied

### 4. Interactions endpoint

- [x] Ed25519 verification on the raw body, the timestamp window and `PING`
- [x] `junk-requests.sh` for checking forged and malformed requests against a deployment
- [x] Recording with dedup on the interaction id and a stored configuration snapshot
- [x] Initial responses: deferred, modal, inline and deferred update
- [x] Report buttons for acknowledge, escalate and resolve, with permission checks
- [x] `/connect` with one-time codes and per-server command registration

### 5. Delivery pipeline

- [x] AI summary, tags and severity suggestion through Groq with a 5-second timeout
- [x] Mirror adapters for Discord channel webhooks and Slack incoming webhooks
- [x] Job table with leases, claiming through `FOR UPDATE SKIP LOCKED` and lease-token fencing
- [x] Retry policy with backoff, `Retry-After` support and interaction-token deadlines
- [x] Inline runner and handlers for reply, channel card, mirror, AI enrichment, card updates and failure notices
- [x] Reconciliation of channel cards and Discord mirrors after an unknown outcome
- [x] Cron sweep endpoint with housekeeping, and the Cloudflare Worker that calls it every minute

### 6. Admin API

- [x] Servers: list, channels, report channel and mirror settings, test message, command sync, disconnect and demo toggles
- [x] Bot invite details and one-time connect codes
- [ ] Command configuration with versioned saves and a rule tester for unsaved drafts
- [ ] Overview figures, live feed with a change cursor, interaction timeline and security events
- [ ] Retrying and failed jobs with single and bulk retry

### 7. Tests

- [x] Unit tests for utilities, environment, rule engine, permissions, webhooks, retry policy and HTTP helpers
- [x] Integration tests for authentication
- [x] Integration tests for the interactions endpoint, the report pipeline and the connect flow
- [ ] Integration tests for retries, leases, reconciliation, deadlines, scrubbing and the cron endpoint
- [ ] Integration tests for the admin API

### 8. Documentation

- [x] `CLAUDE.md` with the code style and invariants
- [ ] README with architecture, local setup, environment variables, deployment and the quality bar
- [ ] `AI_NOTES.md`

### 9. Deployment

- [ ] Supabase project with migrations applied and the reviewer admin seeded
- [ ] Vercel project with the production environment variables
- [ ] Cloudflare Worker deployed with `CRON_SECRET`
- [ ] Interactions Endpoint URL saved in the Discord Developer Portal and commands registered
- [ ] `junk-requests.sh` run against production
- [ ] Reviewer kit: test server invite and throwaway admin account
