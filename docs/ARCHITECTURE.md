# Architecture

## Overview

One Next.js App Router project. The browser talks to Node API routes. Those routes call a compiled LangGraph.js `StateGraph`. Retrieval uses **Qdrant** (vector + keyword). Chat uses **MongoDB**, scoped to a signed-in account. On Auto, classify peeks at that account’s files before choosing **index**, **search**, or **general**. **My files** and **Web only** skip the peek. Locked retrieve uses one filename.

```
Browser (src/app/page.tsx)
    |  POST /api/upload   POST /api/query   GET/DELETE /api/sources
    v
API routes (Node runtime)
    |  MongoDB history     Qdrant retrieve
    v
runAdaptiveRag(question, history, { mode, lockedFile, userId, sessionId })
    v
StateGraph: classify peeks Qdrant on Auto
                 |-- relevant chunks --> generate (or webSearch if the question also needs live facts)
                 |-- not relevant --> webSearch | generalLlm
My files: classify -> retrieve -> grade -> generate
Web only: classify -> webSearch -> generate
```

The classify **node** is named `classify` because LangGraph will not allow a node name that matches a state key (`route`).

## Query types

| Type | When | Pipeline |
| --- | --- | --- |
| **Index** | Answer is in uploaded / sample documents | On Auto, a hybrid peek of this account's files plus samples is graded. A useful peek answers from those chunks. My files still uses hybrid retrieve, then grade, then one rewrite. |
| **General** | Greeting, math, common knowledge | `generalLlm` only |
| **Search** | Live / current-world facts | Tavily → generate |
| **My files** (mode) | User forced documents | skip classify LLM; retrieve (or `lockedFile`); never Tavily; refuse if chunks cannot answer |
| **Web only** (mode) | User forced live web | skip classify LLM; Tavily → generate |

The router uses conversation history so short follow-ups stay on the right pipeline. `npm run eval` always uses Auto.

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
| `answerMode` | `auto` \| `files` \| `web` |
| `lockedFile` | Optional filename for retrieve |
| `userId` | Signed-in account; Qdrant retrieve only samples + this user |
| `sessionId` | This account’s chat; Mongo history is this id only |
| `provenance` | Banner kind, file/web sources, optional quote |

Provenance is built in [`src/lib/graph/provenance.ts`](../src/lib/graph/provenance.ts).

## APIs

Sample knowledge base: every `.txt` in [`data/sample/`](../data/sample/) is seeded if that filename is not already in Qdrant.

**POST `/api/auth/signup`** and **POST `/api/auth/login`**  
JSON `{ email, password }`. Creates or checks the MongoDB user, sets an httpOnly cookie.

**POST `/api/auth/logout`**  
Deletes the auth session and clears the cookie.

**GET `/api/auth/me`**  
Returns `{ id, email }` for the cookie, or 401.

**POST `/api/upload`**  
Cookie plus form fields `file` and optional `sessionId`. `.txt` only. Chunk, embed, upsert into Qdrant with that `userId`. Same name replaces that account’s copy.

**GET `/api/sources`**  
Sample files plus this account’s uploads (name, origin, chunk count).

**DELETE `/api/sources`**  
JSON `{ filename }`. Removes that account’s upload from Qdrant and `data/uploads/{userId}/` if present. Sample file is blocked.

**POST `/api/query`**  
Cookie plus JSON `{ query, sessionId, mode?, lockedFile? }`. `mode` is `auto` (default), `files`, or `web`. The chat must belong to this account. Qdrant retrieve is sample files plus this `userId`. Returns answer, route, trace, sources, metrics, provenance, history.

**GET `/api/query?sessionId=`**  
That account’s session history and visible chunk count.

**GET `/api/sessions`**  
Title, time, and message count for this account’s chats. Empty sessions are omitted.

## Persistence

| Data | Where | Survives refresh? | Survives server restart? |
| --- | --- | --- | --- |
| Account | MongoDB `users` | Yes | Yes |
| Auth session | MongoDB `authSessions` + httpOnly cookie | Yes, until logout or 30 days | Yes |
| Chat | MongoDB `messages` by `userId` | Yes | Yes |
| Session metadata | MongoDB `sessions` by `userId` | Yes | Yes |
| Open chat id | `localStorage` key `adaptive-rag-session` | Yes, this browser | No |
| Vectors | Qdrant collection (uploads tagged with `userId`) | Yes | Yes |
| Raw uploads | `data/uploads/{userId}/{filename}` when the app disk is writable | Local yes; Vercel no | Local yes |

## Key files

```
src/lib/graph/state.ts      graph state
src/lib/graph/nodes.ts      node logic and edge helpers
src/lib/graph/index.ts      compile + runAdaptiveRag
src/lib/graph/observe.ts    hop timing
src/lib/graph/provenance.ts files vs web vs model banner
src/lib/eval/groundedness.ts  claim vs chunk check
src/lib/auth/                signup, login, httpOnly cookie
src/lib/rag/store.ts        Qdrant chunk / hybrid retrieve / peek
src/lib/db/mongo.ts         Mongo client
src/lib/memory/sessions.ts  session + message CRUD
src/lib/llm.ts              OpenAI or Azure OpenAI clients
src/app/api/query/route.ts
src/app/api/upload/route.ts
src/app/api/sources/route.ts
src/app/api/auth/           signup, login, logout, me
src/app/page.tsx            chat, sign-in, modes, file lock, provenance
docker-compose.yml          local MongoDB + Qdrant
```
