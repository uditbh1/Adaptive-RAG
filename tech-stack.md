# Tech stack

What this repo actually runs. Why each piece was picked is in [decision.md](decision.md). Product intent is in [prd.md](prd.md).

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
Models      OpenAI or Azure OpenAI via @langchain/openai  src/lib/llm.ts
Retrieval   Qdrant hybrid  src/lib/rag/store.ts
Sessions    MongoDB  src/lib/memory/sessions.ts
Web         Tavily  @langchain/tavily
Validation  Zod (structured classify / grade / rewrite)
Eval        tsx + eval/cases.json + groundedness
```

## Application

| Piece | Choice | Role |
| --- | --- | --- |
| Framework | Next.js `^15.5` | UI + `/api/upload` + `/api/query` + `/api/sources` |
| UI library | React `^19.1` | Chat page, path chips, file list |
| Styling | Tailwind CSS v4 | Layout and chips |
| Module alias | `@/*` → `src/*` | Imports |

API routes are **not** Edge: LangChain, Qdrant, and MongoDB need Node. See `serverExternalPackages` in `next.config.ts`.

## Orchestration and LLM

| Piece | Package | Role |
| --- | --- | --- |
| Graph | `@langchain/langgraph` | `StateGraph`, conditional edges |
| Graph state | `Annotation.Root` | `question`, `route`, `documents`, `trace`, `metrics`, … |
| Core types / documents | `@langchain/core` | `Document`, messages |
| Chat | `ChatOpenAI` or `AzureChatOpenAI` | Classify, grade, rewrite, generate, general |
| Embeddings | `OpenAIEmbeddings` or `AzureOpenAIEmbeddings` | Chunk vectors |
| Structured output | Zod `^3.25` + `withStructuredOutput` | `index \| search \| general`, grade boolean |
| Defaults | `gpt-4o-mini`, `text-embedding-3-small` | Overridable via env |

The classify **node** is named `classify`. The state field is `route`. LangGraph forbids using the same string for both.

## Retrieval and search

| Piece | Package / path | Role |
| --- | --- | --- |
| Splitter | `@langchain/textsplitters` | ~1000 size, 150 overlap |
| Vector store | `@langchain/qdrant` `QdrantVectorStore` | Document embeddings |
| Qdrant client | `@qdrant/js-client-rest` | Collection, text index, keyword scroll |
| Hybrid | vector + `content` text match, RRF | Default retrieve when no filename is named |
| Uploads | `data/uploads/` | One `.txt` per filename |
| Sample corpus | `data/sample/azure-ai.txt` | Seed if Qdrant collection is empty |
| Web search | `@langchain/tavily` `TavilySearch` | `search` path and index fallback |
| Chat DB | `mongodb` | `sessions` + `messages` collections |

Not in v1: PDF parsers, Azure AI Search, login.

## Eval and tooling

| Piece | Package / command | Role |
| --- | --- | --- |
| Eval runner | `tsx eval/run.ts` / `npm run eval` | Route check + index groundedness |
| Cases | `eval/cases.json` | 5 index, 3 search, 2 general |
| Env load | `dotenv` | `.env.local` then `.env` |
| Types | `typescript` `^5.8` | `npx tsc --noEmit` |
| Lint | `eslint` + `eslint-config-next` | `npm run lint` |
| CI | `.github/workflows/ci.yml` | `tsc` + lint |

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes, unless Azure is set | Chat + embeddings |
| `AZURE_OPENAI_API_KEY` | Azure path | Used with instance + deployment names |
| `AZURE_OPENAI_API_INSTANCE_NAME` | Azure path | Or parse from `AZURE_OPENAI_ENDPOINT` |
| `AZURE_OPENAI_API_DEPLOYMENT_NAME` | Azure path | Chat deployment |
| `AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME` | Azure path | Embedding deployment |
| `TAVILY_API_KEY` | For web path | Tavily; missing → explicit skip snippet |
| `OPENAI_CHAT_MODEL` | No | Default `gpt-4o-mini` |
| `OPENAI_EMBEDDING_MODEL` | No | Default `text-embedding-3-small` |
| `MONGODB_URI` | Yes | Chat history, default `mongodb://127.0.0.1:27017` |
| `MONGODB_DB` | No | Default `adaptive_rag` |
| `QDRANT_URL` | Yes | Vector store, default `http://127.0.0.1:6333` |
| `QDRANT_API_KEY` | Cloud only | Leave empty for local Docker |
| `QDRANT_COLLECTION` | No | Default `adaptive_rag_docs` |

Never commit `.env` or `.env.local`. Template: `.env.example`.

## Scripts

```bash
docker compose up -d   # MongoDB + Qdrant
npm run dev            # Next.js local app
npm run build          # production compile
npm run eval           # router + groundedness
npx tsc --noEmit
npm run lint
```

## What I did not use (v1)

| Common choice | Why not |
| --- | --- |
| Python / FastAPI / Streamlit | The app is TypeScript; see D-001 |
| Azure OpenAI as the only client | OpenAI is the default; Azure is an env switch in `src/lib/llm.ts` |
| CrewAI / extra agents | Adaptive RAG is one graph with roles as nodes (D-002) |
| PDF ingest | Still out of scope (D-011) |
