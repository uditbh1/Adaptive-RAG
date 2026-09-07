# Tech stack

What this repo actually runs. Why we picked each piece is in [decision.md](decision.md). Product intent is in [prd.md](prd.md).

| Field | Value |
| --- | --- |
| App | Next.js 15 App Router |
| Language | TypeScript (strict) |
| Package manager | npm (`package-lock.json`) |
| Runtime | Node.js (API routes: `runtime = "nodejs"`) |

---

## Layers

```
UI          Next.js (React 19)  src/app/page.tsx
API         Next.js Route Handlers  src/app/api/*/route.ts
Orchestration   LangGraph.js StateGraph  src/lib/graph/
Models      OpenAI via @langchain/openai  src/lib/llm.ts
Retrieval   Qdrant via @langchain/qdrant  src/lib/rag/store.ts
Sessions    MongoDB  src/lib/memory/sessions.ts
Web         Tavily  @langchain/tavily
Validation  Zod (structured classify / grade / rewrite)
Eval        tsx + eval/cases.json
```

## Application

| Piece | Choice | Role |
| --- | --- | --- |
| Framework | Next.js `^15.5` | UI + `/api/upload` + `/api/query` |
| UI library | React `^19.1` | Chat page, path chips |
| Styling | `src/app/globals.css` | No Tailwind in v1 |
| Module alias | `@/*` → `src/*` | Imports |

API routes are **not** Edge: LangChain, Qdrant, and MongoDB need Node. See `serverExternalPackages` in `next.config.ts`.

## Orchestration and LLM

| Piece | Package | Role |
| --- | --- | --- |
| Graph | `@langchain/langgraph` | `StateGraph`, conditional edges |
| Graph state | `Annotation.Root` | `question`, `route`, `documents`, `trace`, … |
| Core types / documents | `@langchain/core` | `Document`, messages |
| Chat | `@langchain/openai` `ChatOpenAI` | Classify, grade, rewrite, generate, general |
| Embeddings | `@langchain/openai` `OpenAIEmbeddings` | Chunk vectors |
| Structured output | Zod `^3.25` + `withStructuredOutput` | `index \| search \| general`, grade boolean |
| Defaults | `gpt-4o-mini`, `text-embedding-3-small` | Overridable via env |

The classify **node** is named `classify`. The state field is `route`. LangGraph forbids using the same string for both.

## Retrieval and search

| Piece | Package / path | Role |
| --- | --- | --- |
| Splitter | `@langchain/textsplitters` | ~1000 size, 150 overlap |
| Vector store | `@langchain/qdrant` `QdrantVectorStore` | Document embeddings |
| Qdrant client | `@qdrant/js-client-rest` | Collection create / point count |
| Uploads | `data/uploads/` | Raw `.txt` copies |
| Sample corpus | `data/sample/azure-ai.txt` | Seed if Qdrant collection is empty |
| Web search | `@langchain/tavily` `TavilySearch` | `search` path and index fallback |
| Chat DB | `mongodb` | `sessions` + `messages` collections |

Not in v1: PDF parsers, Azure AI Search, login.

## Eval and tooling

| Piece | Package / command | Role |
| --- | --- | --- |
| Eval runner | `tsx eval/run.ts` / `npm run eval` | Expected vs actual `route` |
| Cases | `eval/cases.json` | 5 index, 3 search, 2 general |
| Env load | `dotenv` | `.env.local` in eval |
| Types | `typescript` `^5.8` | `npx tsc --noEmit` |
| Lint | `eslint` + `eslint-config-next` | `npm run lint` |

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes | Chat + embeddings |
| `TAVILY_API_KEY` | For web path | Tavily; missing → explicit skip snippet |
| `OPENAI_CHAT_MODEL` | No | Default `gpt-4o-mini` |
| `OPENAI_EMBEDDING_MODEL` | No | Default `text-embedding-3-small` |
| `MONGODB_URI` | Yes | Chat history, default `mongodb://127.0.0.1:27017` |
| `MONGODB_DB` | No | Default `adaptive_rag` |
| `QDRANT_URL` | Yes | Vector store, default `http://127.0.0.1:6333` |
| `QDRANT_API_KEY` | Cloud only | Leave empty for local Docker |
| `QDRANT_COLLECTION` | No | Default `adaptive_rag_docs` |

Never commit `.env.local`. Template: `.env.example`.

## Scripts

```bash
docker compose up -d   # MongoDB + Qdrant
npm run dev            # Next.js local app
npm run build          # production compile
npm run eval           # router accuracy table
npx tsc --noEmit
```

## What we did not use (v1)

| Common choice | Why not |
| --- | --- |
| Python / FastAPI / Streamlit | Product is TypeScript; see D-001 |
| Azure OpenAI | OpenAI API first; swap is isolated to `src/lib/llm.ts` (D-006) |
| CrewAI / extra agents | Adaptive RAG is one graph with roles as nodes (D-002) |
| Tailwind | One CSS file is enough for the chat page |
| PDF ingest | Still out of scope (D-011) |

When you add or replace a library, update this file **and** append an entry in [decision.md](decision.md).
