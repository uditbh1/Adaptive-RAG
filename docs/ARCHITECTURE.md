# Architecture

## Overview

One Next.js App Router project. The browser talks to Node API routes. Those routes call a compiled LangGraph.js `StateGraph`. Retrieval uses **Qdrant** (vector + keyword). Chat uses **MongoDB**. Classification picks one of three pipelines: **index**, **general**, **search**.

```
Browser (src/app/page.tsx)
    |  POST /api/upload   POST /api/query   GET/DELETE /api/sources
    v
API routes (Node runtime)
    |  MongoDB history     Qdrant retrieve
    v
runAdaptiveRag(question, history)
    v
StateGraph: classify -> retrieve | webSearch | generalLlm
                 |         |
                 v         v
               grade    generate
                 |
        relevant? --yes--> generate (or webSearch if the question also needs live facts)
                 |
        rewrite once, else webSearch -> generate
```

The classify **node** is named `classify` because LangGraph will not allow a node name that matches a state key (`route`).

## Query types

| Type | When | Pipeline |
| --- | --- | --- |
| **Index** | Answer is in uploaded / sample documents | hybrid retrieve (filename first, else vector+keyword) → grade → (rewrite once) → generate. Mixed file + live questions keep file chunks and also web-search. |
| **General** | Greeting, math, common knowledge | `generalLlm` only |
| **Search** | Live / current-world facts | Tavily → generate |

The router uses conversation history so short follow-ups stay on the right pipeline.

## Graph state

Defined in [`src/lib/graph/state.ts`](../src/lib/graph/state.ts):

| Field | Role |
| --- | --- |
| `question` | Current query (may change after rewrite) |
| `originalQuestion` | User wording, kept for generate |
| `history` | Recent MongoDB turns, as text |
| `route` | `index` \| `search` \| `general` |
| `documents` | Last retrieved or searched snippets |
| `rewriteCount` | 0 or 1 |
| `relevant` | Grade result |
| `answer` | Final text |
| `sources` | Filenames / URLs used for the answer |
| `metrics` | Per-hop time and token counts |
| `trace` | Append-only hop labels for the UI |

## APIs

Sample knowledge base: every `.txt` in [`data/sample/`](../data/sample/) is seeded if that filename is not already in Qdrant.

**POST `/api/upload`**  
Form field `file`. `.txt` only. Chunk, embed, upsert into Qdrant. Same name replaces.

**GET `/api/sources`**  
List indexed files (name, origin, chunk count).

**DELETE `/api/sources`**  
JSON `{ filename }`. Removes an upload from Qdrant and `data/uploads/`. Sample file is blocked.

**POST `/api/query`**  
JSON `{ query, sessionId }`. Loads history from MongoDB, runs the graph, appends both turns. Returns answer, route, trace, sources, metrics, history.

**GET `/api/query?sessionId=`**  
Full session history and Qdrant chunk count.

## Persistence

| Data | Where | Survives refresh? | Survives server restart? |
| --- | --- | --- | --- |
| Chat | MongoDB `messages` | Yes (same `sessionId` in `localStorage`) | Yes |
| Session metadata | MongoDB `sessions` | Yes | Yes |
| Vectors | Qdrant collection | Yes | Yes |
| Raw uploads | `data/uploads/{filename}` (one file per name) | Yes | Yes |

## Key files

```
src/lib/graph/state.ts      graph state
src/lib/graph/nodes.ts      node logic and edge helpers
src/lib/graph/index.ts      compile + runAdaptiveRag
src/lib/graph/observe.ts    hop timing
src/lib/eval/groundedness.ts  claim vs chunk check
src/lib/rag/store.ts        Qdrant chunk / hybrid retrieve
src/lib/db/mongo.ts         Mongo client
src/lib/memory/sessions.ts  session + message CRUD
src/lib/llm.ts              OpenAI or Azure OpenAI clients
src/app/api/query/route.ts
src/app/api/upload/route.ts
src/app/api/sources/route.ts
src/app/page.tsx            chat, files, path chips
docker-compose.yml          local MongoDB + Qdrant
```
