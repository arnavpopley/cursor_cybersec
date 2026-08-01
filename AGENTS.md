<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Keyring is a single Next.js 16 app (App Router + Turbopack, Node 22). There is no separate backend service — API routes live under `app/api/*`. Commands are the standard `package.json` scripts:

- Dev server: `npm run dev` (the committed `.cursor/environment.json` runs it as `npm run dev -- --hostname 0.0.0.0 --port 3000`). Serves on port 3000.
- Tests: `npm test` (Vitest, covers `engine/**` and `lib/**` only).
- Build: `npm run build` (succeeds; Turbopack build does not gate on ESLint).
- Lint: `npm run lint`.

Non-obvious caveats:

- The whole demo runs fully offline. No `OPENAI_API_KEY`, Supabase, or ElevenLabs keys are needed for analyze → findings → ask (engine fallback) → NFC approval → simulated voice. Missing keys degrade gracefully. Copy `.env.local.example` to `.env.local` only if you want to exercise the optional hosted/LLM/voice paths.
- Fastest way to see a working app: open `http://localhost:3000/?demo=1`, which auto-loads the Acme fixture and populates the findings panel.
- NFC approval has a keyboard fallback: focus the Keyring browser window and press `Ctrl+Shift+A` to simulate a tap and release a pending request (useful since no physical tag exists in the VM).
- `POST /api/analyze` expects a JSON body of the shape `{ "raw": "<stringified account JSON>" }`, not the raw fixture object.
- `npm run lint` currently reports pre-existing errors (e.g. in `components/keyring/workspace.tsx` and `engine/graph.ts`). These are not caused by environment setup and do not block build/dev.
- The environment source of truth is `.cursor/Dockerfile` (referenced by `.cursor/environment.json`). Change environment/system deps there; saving a snapshot is a no-op.
