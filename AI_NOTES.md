# AI Notes

## Tools and split of work

- **Claude Code** (Claude Opus) in the editor and terminal, guided by `CLAUDE.md` in each repository.
- I chose the architecture and reliability model, set the constraints, reviewed every change and decided what to keep. Claude restated the brief as a simplified requirements document, then drafted the implementation plan, module code, tests and documentation against that plan, and ran lint and tests after each step.
- The AI step inside the product uses Groq (`openai/gpt-oss-20b`, low reasoning effort) in JSON mode for a one-line summary, tags from a fixed list and a severity suggestion. Its output is validated and capped, and the report is never blocked on it.

## How I prompted

I worked in short, gated steps. Standing rules lived in Claude Code's project memory and in each repository's `CLAUDE.md`, so they applied in every session.

- **Requirements before design.** I first asked for the brief restated "without missing anything and not assuming anything". The result also lists the points the brief leaves open.
- **Expert role, with reasons on demand.** I asked Claude to act as a subject-matter expert and plan before coding, then questioned each choice: Node.js 24 LTS, whether the suggested free services work with Express, secure cookies versus refresh tokens, and Vercel versus EC2 or self-hosting on a spare laptop.
- **Outside review of the plan.** I pasted a critique of the retry design and asked whether each issue was real and resolved. A long in-function retry loop became two inline attempts followed by the per-minute sweeper.
- **Standing rules in memory:**
  - comment-free, professional code in plain JavaScript;
  - frontend and backend as fully independent projects with no shared files;
  - plans that describe only what is built;
  - explanations that say where each setting lives, what it does and how to verify it.
- **Explicit gates.** "List the dashboards I need first, then wait for my heads up", "audit and do not make any changes unless I specify", "make changes but do not commit".
- **Checks against the real services.** Claude audited the Discord, Vercel, Supabase and Cloudflare dashboards through the browser connector. This caught the Discord guild install missing the `bot` scope, and Supabase's Data API exposing tables that have no row-level security while SSL was not yet enforced.
- **Verifying deployments by behaviour, never by reading secrets.** After "check vercel, app has been deployed", Claude probed the live backend instead of opening secret values. A login request was accepted from `http://localhost:5173` and rejected from the real frontend, which showed that my local `.env` had been pasted into Vercel wholesale, Dev Discord app and `NODE_ENV=development` included. Later checks confirmed the fix from the outside: the session row was created with `secure: true`, and Discord saved the production endpoint URL only after the production public key was in place.
- **Debugging from symptoms.** I described what I saw and asked for the cause before any fix. "Why is the AI summary failing?" surfaced a retired Groq model, which led to readable provider errors and `openai/gpt-oss-20b` with low reasoning effort. "Why is the status shown as done when the report has not been acted on?" led to separating delivery status from report state in the live log.
- **Questioning names and leftovers.** "Component" interactions were renamed to button and report-form types. The 300-second signature timestamp window was removed, because replays are already stopped by the interaction-id primary key. When Claude moved the bot's display name into a shared `APP_DISPLAY_NAME` constant, I asked whether a value used in one place belonged in constants at all; it went back inline.
- **Scope questions before features.** I asked whether admins should be able to register new slash commands from the dashboard. The answer kept commands defined in code: a command is a Discord listing plus behaviour, and a dashboard can only create the listing. The dashboard configures behaviour and can re-register the existing set, and a data-driven "custom reply command" type is the shape it would take if it were ever needed.
- **Documentation generated from the code.** I asked for one page explaining the whole system. Claude produced an architecture handbook with flow, sequence, state and entity diagrams, checking timeouts, retry delays, permissions and table names against the source rather than the plan.

**Correcting a wrong turn.** I pointed Claude at two reference projects for their folder structure. It also copied their TypeScript setup, although I had asked for plain Node.js:

> "I already told not to use typescript. Only nodejs, then why are you using typescript? … I just wanted you to copy folder structure and nothing else. Now remove both the folders frontend and backend and start everything from scratch."

Both projects were rebuilt in JavaScript, and the rule went into memory so it could not recur. An early version also shared configuration files between frontend and backend; I had those separated so each project stands on its own.

A second wrong turn surfaced at the first push. The tests used realistic-looking fake Slack webhook URLs, and GitHub push protection rejected both repositories as containing secrets. Claude first scanned the full history to confirm nothing real had leaked, then offered two fixes: allow the fixture on GitHub, or rewrite it. I chose the rewrite, so the three local commits that introduced it were rewritten with an obviously fake fixture, keeping messages, authors and dates, and verified with lint, formatting and both test suites before pushing.

## Key decisions

- **Vercel with a Cloudflare cron.** Vercel runs the Express app as a function and keeps background work alive with `waitUntil`. Its Hobby cron runs daily, so a free Cloudflare Worker calls the sweeper every minute.
- **A job table with leases and reconciliation.** Each side effect is a row with a lease token, attempts, a deadline and a recorded outcome. Any instance can resume work, retries cannot run twice, and ambiguous failures are checked before resending. This replaces a queue service while keeping the guarantees the brief asks for.
- **Supabase Postgres** through the transaction pooler, with Drizzle migrations in the repository. The project landed in Seoul, so the backend functions are pinned to Vercel's `icn1` region; every interaction makes several queries inside Discord's 3-second window, and a trans-Pacific round trip per query would eat that budget.
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
