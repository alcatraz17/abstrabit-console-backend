# AI Notes

## Tools and split of work

- **Claude Code** (Claude Opus) in the editor and terminal, guided by `CLAUDE.md` in each repository.
- I wrote the requirements breakdown, chose the architecture and reliability model, reviewed every change and decided what to keep. Claude drafted the implementation plan, module code, tests and documentation against that plan, and ran lint and tests after each step.
- The AI step inside the product uses Groq (`openai/gpt-oss-20b`, low reasoning effort) in JSON mode for a one-line summary, tags from a fixed list and a severity suggestion. Its output is validated and capped, and the report is never blocked on it.

## Key decisions

- **Vercel with a Cloudflare cron.** Vercel runs the Express app as a function and keeps background work alive with `waitUntil`. Its Hobby cron runs daily, so a free Cloudflare Worker calls the sweeper every minute.
- **A job table with leases and reconciliation.** Each side effect is a row with a lease token, attempts, a deadline and a recorded outcome. Any instance can resume work, retries cannot run twice, and ambiguous failures are checked before resending. This replaces a queue service while keeping the guarantees the brief asks for.
- **Supabase Postgres** through the transaction pooler, with Drizzle migrations in the repository.
- **Server-side sessions** in an HttpOnly cookie rather than tokens in the browser. Sign-out and password resets revoke access immediately, and nothing secret is readable by scripts.
- **One origin.** The frontend project rewrites `/api/*` to the backend. Cookies stay first-party, CORS is unnecessary and the origin check is a simple equality.

## Hardest problem

**Retries that duplicate messages.** A channel post can time out after Discord has already created the message. A naive retry then posts a second card. The fix records each attempt's outcome as `ok`, `not_sent`, `rejected` or `unknown`. After an `unknown`, the retry first looks for the existing card by the stored id, then by the report marker in recent channel messages. It only posts when the card is truly absent, and Discord's nonce covers the first few minutes as well. The integration test simulates a post that succeeds on Discord's side but times out locally, and asserts that exactly one card exists.

Other issues caught in review:

- A manually retried processing job died immediately because its original deadline had passed. Manual retries now clear that deadline.
- Configuration change events listed every key as changed because Postgres `jsonb` reorders keys. Values are now compared in canonical form.
- `??` treated an empty `MIGRATION_DATABASE_URL=` in `.env` as set. Fallbacks now use `||`.
- The migration script compared `import.meta.url` with an unencoded path and silently did nothing in a directory with spaces. It now uses `pathToFileURL`.

## Improvements with more time

- A durable queue (for example Cloudflare Queues) in place of polling, once traffic justifies it.
- Discord OAuth for per-server admins instead of connect codes tied to console accounts.
- Metrics and alerting on acknowledgement latency, dead jobs and sweeper age.
- A shared, versioned API schema published from the backend for the frontend to consume.
