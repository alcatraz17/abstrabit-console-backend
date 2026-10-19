# Abstrabit Console Backend

The API behind a Discord slash-command bot and its admin console. Discord delivers commands to an HTTP interactions endpoint; the backend verifies them, records them, acknowledges within Discord's 3-second window and runs every side effect (reply, channel card, mirror, AI summary) as a persisted job with retries and reconciliation. Admins use the console to watch traffic, configure commands and rules, connect servers and recover failures.

- **Commands:** `/report` (text or form, severity, buttons to acknowledge, escalate and resolve), `/status` (open reports, today's volume and delivery health for the server), `/connect` (links a server to an admin account).
- **Stack:** Node.js 24, Express 5, JavaScript ES modules, PostgreSQL (Supabase) with Drizzle ORM, zod, pino, Vitest + supertest.
- **Hosting:** Vercel (Express preset) with a Cloudflare Worker cron; the frontend Vercel project rewrites `/api/*` here so the browser sees one origin.

## Architecture

```
Discord ──POST /api/discord/interactions──▶ verify Ed25519 + timestamp
                                              │ record interaction (dedup by id)
                                              │ create `process` job
                                              ▼
                                   initial response (< 3 s)
                                              │ background()
                                              ▼
                     process ──▶ discord_reply · channel_post · mirror · ai_enrich
                        │            (child jobs created in the same transaction)
                        ▼
              inline attempts (2, ~15 s) ──▶ sweeper retries (1, 2, 4, 8, 10 min)
                                                 ▲
             Cloudflare cron (every minute) ─────┘  GET /api/cron/sweep (Bearer CRON_SECRET)

Browser ──▶ frontend (Vercel) ──/api/* rewrite──▶ /api/auth/* · /api/admin/*  (session cookie)
```

| Path                                    | Purpose                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| `src/app.js`                            | Express app and middleware order; the default export Vercel serves |
| `src/server.js`                         | Local HTTP server with graceful shutdown                           |
| `src/config`                            | Validated environment and domain constants                         |
| `src/db`                                | Drizzle schema, pool and SQL migrations                            |
| `src/middleware`                        | Session, admin and guild access, origin check, validation, errors  |
| `src/modules/interactions`              | Discord endpoint, verification, recording, job handlers            |
| `src/modules/jobs`                      | Claiming with leases, retry policy, runner and sweeper             |
| `src/modules/commands`                  | Command configuration, defaults and the rule engine                |
| `src/modules/guilds`                    | Connect codes, channels, mirror settings, demo toggles             |
| `src/modules/dashboard`                 | Overview figures, live feed, interaction timeline, security events |
| `src/modules/discord` · `mirror` · `ai` | Discord REST, Discord/Slack webhooks, Groq                         |
| `cron-worker/`                          | Cloudflare Worker that calls the sweeper every minute              |

## Local setup

Prerequisites: Node.js 24, Docker (for the test database), and a Discord application for development.

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run seed:admin -- --email you@example.com
npm run register:commands
npm run dev
```

- `npm run seed:admin` prompts for the password (12 characters or more). Add `--reset` to replace an existing admin's password, which also signs out their sessions.
- `npm run register:commands` registers `/connect` globally. `/report` and `/status` are registered per server when it is connected. Pass `--guild <id>` to register `/report` and `/status` in one server directly during development.
- Discord needs a public HTTPS URL. Run `cloudflared tunnel --url http://localhost:3000` and set the development application's Interactions Endpoint URL to `<tunnel>/api/discord/interactions`.
- Run the frontend with `npm run dev` in `abstrabit-console-frontend`; Vite proxies `/api` to port 3000, so `APP_URL` stays `http://localhost:5173`.

### Connecting a server

1. In the console, open **Servers**, invite the bot with the invite link, and create a connect code.
2. In the server, a member with **Manage Server** runs `/connect code:<code>` within 10 minutes.
3. The server appears in the console; choose the report channel and the mirror.

## Environment variables

| Variable                 | Required | Purpose                                                                            |
| ------------------------ | -------- | ---------------------------------------------------------------------------------- |
| `NODE_ENV`               |          | `development`, `test` or `production`                                              |
| `PORT`                   |          | Local port (3000)                                                                  |
| `APP_URL`                | yes      | Public URL of the console; used for the origin check and links                     |
| `LOG_LEVEL`              |          | pino level (`info`)                                                                |
| `DATABASE_URL`           | yes      | Supabase transaction pooler, port 6543                                             |
| `MIGRATION_DATABASE_URL` |          | Supabase session pooler, port 5432; used by `db:migrate` and drizzle-kit           |
| `DATABASE_POOL_MAX`      |          | Connections per instance (5)                                                       |
| `DATABASE_CA_CERT`       |          | Supabase CA certificate (PEM); enables verified TLS                                |
| `SESSION_SECRET`         | yes      | One or more comma-separated secrets of 32+ characters; the first signs, all verify |
| `ENCRYPTION_KEY`         | yes      | 32 bytes, base64; encrypts webhook URLs and interaction tokens at rest             |
| `DISCORD_APPLICATION_ID` | yes      | Application id                                                                     |
| `DISCORD_PUBLIC_KEY`     | yes      | Ed25519 key for request verification                                               |
| `DISCORD_BOT_TOKEN`      | yes      | Channel posts, lookups and command registration                                    |
| `CRON_SECRET`            | yes      | Bearer token for `/api/cron/sweep` (32+ characters)                                |
| `GROQ_API_KEY`           |          | Enables AI summaries and tags                                                      |
| `GROQ_MODEL`             |          | Groq model (`llama-3.1-8b-instant`)                                                |

Generate secrets with `openssl rand -base64 32`. Percent-encode special characters in the database password. With `DATABASE_CA_CERT` set, leave `sslmode` out of the connection strings, because a URL parameter overrides the certificate settings.

## Deployment

1. **Supabase.** Copy the transaction pooler (6543) and session pooler (5432) connection strings and download the CA certificate from Database Settings. Run `npm run db:migrate` locally with `MIGRATION_DATABASE_URL` set, then `npm run seed:admin`.
2. **Vercel.** Import this repository with the Express preset and Node.js 24.x. Add the environment variables to Production, with `APP_URL` set to the frontend URL. `vercel.json` pins functions to `icn1` next to the database and adds a daily fallback cron.
3. **Cloudflare cron.** In `cron-worker/`, run `npx wrangler secret put CRON_SECRET` and `npx wrangler deploy`. Update `SWEEP_URL` in `wrangler.toml` if the backend domain differs.
4. **Discord.** Set the Interactions Endpoint URL to `https://<backend>/api/discord/interactions`; Discord saves it only after a successful signed PING. Run `npm run register:commands` with the production credentials.
5. **Check.** `GET /api/health` returns the database status, due jobs and the last sweep time; `./scripts/junk-requests.sh https://<backend>` expects 401 for every forged request.

Recovery from a bad deploy is Vercel's Instant Rollback; migrations are additive.

## How the quality bar is met

| Requirement              | Implementation                                                                                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forged requests rejected | Ed25519 verification of the raw body before any parsing; missing, malformed or invalid signatures get 401 and a `signature_rejected` event                                                                                        |
| Replays rejected         | Timestamps older than 300 s get 401 (`stale_timestamp`); interaction ids are unique, so a replay inside the window is recorded once and acknowledged without side effects (`duplicate_interaction`)                               |
| 3-second window          | The endpoint only verifies, records (1.5 s budget) and acknowledges; `ack_ms` is stored per interaction and shown as average and p95                                                                                              |
| No duplicate actions     | Jobs are unique per interaction and kind, claimed with `FOR UPDATE SKIP LOCKED` and completed only with a matching `lease_token`; button transitions are conditional updates                                                      |
| No silently lost work    | Every side effect is a row in `jobs`; failures retry with backoff up to 8 attempts, then become `dead`, appear on the Failures page and can be retried                                                                            |
| Ambiguous failures       | Attempts record `ok`, `not_sent`, `rejected` or `unknown`; after an unknown outcome the channel card is found by nonce and stored id, and Discord mirrors by their `Ref` footer, before posting again                             |
| Token expiry             | Replies through the interaction token have a 15-minute deadline; the processing job has 12 minutes, after which the user receives a failure notice                                                                                |
| Secrets                  | Validated at startup without echoing values; webhook URLs and interaction tokens encrypted with AES-256-GCM; logs and stored errors pass through a scrubber; the browser never receives a secret                                  |
| Admin access             | Server-side sessions in an HttpOnly `__Host-sid` cookie (SameSite=Lax, 30-minute idle, 8-hour absolute); login limited to 5 failures per email and 20 per IP in 15 minutes; mutating requests require the console origin and JSON |
| Multi-server isolation   | Every admin query is scoped through `admin_guilds`; configuration, jobs and reports carry `guild_id`                                                                                                                              |
| Mentions                 | Discord payloads set `allowed_mentions: { parse: [] }` and user text is escaped                                                                                                                                                   |

Known limitations:

- Slack webhooks return no message id, so a Slack mirror after an ambiguous failure is delivered at least once.
- Work that is not finished inline is retried by the minute sweeper, so a retried action can take up to a minute longer.
- Bots that use HTTP interactions appear offline in Discord's member list; commands still work.

## Testing

```bash
npm run test:db
npm test
npm run lint
npm run format:check
```

`npm run test:db` starts PostgreSQL 17 on port 54329 with Docker; the suite recreates the schema from the migrations. Integration tests sign requests with a generated Ed25519 key and replace `fetch` with a recorder, covering verification, duplicates, button races, lease fencing, reconciliation, deadlines, scrubbing, sessions and guild isolation. CI runs the same steps against a PostgreSQL service container.

## Reviewer kit

- Bot invite: the **Servers** page shows it, or `https://discord.com/oauth2/authorize?client_id=<application-id>&scope=bot%20applications.commands&permissions=84992`.
- Console sign-in: a dedicated reviewer account is shared by email.
- Demo: sign in, run `/report` with outage text, click **Acknowledge**, run `./scripts/junk-requests.sh <backend-url>`, then use **Demo controls** to simulate a mirror outage or a slow AI step and watch the jobs recover on the **Failures** page.
