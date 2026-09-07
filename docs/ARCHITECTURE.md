# Architecture

## Overview

One Next.js App Router project. The browser talks to two Node API routes. Those routes call a compiled LangGraph.js `StateGraph`. Retrieval uses **Qdrant**. Chat uses **MongoDB**. Classification picks one of three pipelines: **index**, **general**, **search**.

```
Browser (src/app/page.tsx)
    |  POST /api/upload   POST /api/query
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
        relevant? --yes--> generate
                 |
        rewrite once, else webSearch -> generate
```

The classify **node** is named `classify` because LangGraph will not allow a node name that matches a state key (`route`).

## Query types

| Type | When | Pipeline |
| --- | --- | --- |
| **Index** | Answer is in uploaded / sample documents | retrieve → grade → (rewrite once) → generate |
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
| `trace` | Append-only hop labels for the UI |

## APIs

**POST `/api/upload`**  
Form field `file`. `.txt` only. Chunk, embed, upsert into Qdrant.

**POST `/api/query`**  
JSON `{ query, sessionId }`. Loads history from MongoDB, runs the graph, appends both turns. Returns answer, route, trace, history.

**GET `/api/query?sessionId=`**  
Full session history and Qdrant chunk count.

## Persistence

| Data | Where | Survives refresh? | Survives server restart? |
| --- | --- | --- | --- |
| Chat | MongoDB `messages` | Yes (same `sessionId` in `localStorage`) | Yes |
| Session metadata | MongoDB `sessions` | Yes | Yes |
| Vectors | Qdrant collection | Yes | Yes |
| Raw uploads | `data/uploads/` | Yes | Yes |

## Key files

```
src/lib/graph/state.ts      graph state
src/lib/graph/nodes.ts      node logic and edge helpers
src/lib/graph/index.ts      compile + runAdaptiveRag
src/lib/rag/store.ts        Qdrant chunk / retrieve
src/lib/db/mongo.ts         Mongo client
src/lib/memory/sessions.ts  session + message CRUD
src/lib/llm.ts              OpenAI clients
src/app/api/query/route.ts
src/app/api/upload/route.ts
src/app/page.tsx            chat, pipelines, path chips
docker-compose.yml          local MongoDB + Qdrant
```
