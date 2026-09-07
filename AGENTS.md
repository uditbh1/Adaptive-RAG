# Agent notes

- Package manager: npm (`package-lock.json`)
- App: Next.js App Router, TypeScript, `src/`
- Graph: [`src/lib/graph/`](src/lib/graph/) — do not name a node the same as a state key (`route` is state; node is `classify`)
- Retrieval: [`src/lib/rag/store.ts`](src/lib/rag/store.ts) — Qdrant (`QDRANT_URL`)
- Chat: MongoDB [`src/lib/memory/sessions.ts`](src/lib/memory/sessions.ts) (`MONGODB_URI`)
- Secrets: `.env.local` only (`OPENAI_API_KEY`, `TAVILY_API_KEY`, `MONGODB_URI`, `QDRANT_URL`)
- Commands: `docker compose up -d`, `npm run dev`, `npx tsc --noEmit`, `npm run eval`
- Docs: [prd.md](prd.md), [tech-stack.md](tech-stack.md), [decision.md](decision.md) (append new choices; next ID in the index), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/EVALUATION.md](docs/EVALUATION.md)
- Do not add login or PDF unless [prd.md](prd.md) and [decision.md](decision.md) change
