# AI Daily

A Thai-language daily for AI news, with the editorial back office attached. Readers get a
general feed and a developer-oriented one; editors get a review queue, a draft editor, and an
approval trail that cannot be rewritten after the fact.

> **Status: prototype.** Runs locally against mock data. Nothing is deployed, and no production
> service is wired up yet.

## What works today

- Reader feed, a separate developer view, and article pages with their sources
- Editorial back office — review queue, draft creation, revision
- Immutable revision history and approval records
- Supabase schema, RLS policies, and RPCs covering the editor workflow
- Static export: `out/` drops onto any static host
- Unit tests, PostgreSQL contract tests, and Playwright browser tests

Product detail lives in [PRD.md](./PRD.md).

## Stack

Next.js · TypeScript · Tailwind CSS 4 · daisyUI 5 · Supabase/PostgreSQL · Playwright

## Getting started

Node.js 22.18 or newer.

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. The default data source is mock data, so no account or API key is
needed to look around.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript, no emit |
| `npm run build` | Production static export into `out/` |
| `npm start` | Serve the built export |
| `npm run test:e2e` | Playwright browser tests |
| `npm run test:db` | PostgreSQL contract tests via Docker |

`npm run test:db` expects Docker and a local `postgres:16` image. It will not pull the image for
you — that is deliberate, so a test run never surprises you with a download.

## Supabase

Copy `.env.example` to `.env.local` and fill in public values only:

```env
NEXT_PUBLIC_DATA_SOURCE=supabase
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
```

Service-role keys belong nowhere near this file. Authorization is enforced by RLS in the
database, not by the client.

## AI provider keys

The site is a static export, so an AI provider key must never appear in a `NEXT_PUBLIC_*`
variable or anywhere in the source. Keys live server-side, in Edge Function secrets.

- **Production** — set `AI_PROVIDER`, `AI_MODEL` and the provider's key under
  **Edge Functions → Secrets** in the Supabase Dashboard
- **Local Edge Functions** — `supabase/functions/.env`, which is gitignored
- Example values are in `supabase/functions/.env.example`; the helper waiting to be wired up is
  `supabase/functions/_shared/ai-config.ts`

| `AI_PROVIDER` | Secret the system reads |
| --- | --- |
| `deepseek` | `DEEPSEEK_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `gemini` | `GEMINI_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |

Only the active provider's key is read, and no provider is actually called yet. If admins are
ever allowed to manage several credentials from the web UI, store one Supabase Vault secret per
credential and keep only the Vault UUID in `private.credential_refs` — never the key itself.

## License

[MIT](./LICENSE)
