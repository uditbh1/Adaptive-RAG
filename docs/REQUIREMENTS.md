# Requirements

Engineering IDs for Adaptive RAG. Product spec: [prd.md](../prd.md). Stack: [tech-stack.md](../tech-stack.md). Decisions: [decision.md](../decision.md).

## Problem

A single chat model either invents sources or always retrieves documents, even when the question is a greeting or needs live news. This project routes each question to the right path and only generates from context that passed a relevance check.

## Goals

- Answer questions from uploaded text, the live web, or the model alone.
- Show the graph path, sources, and hop timing.
- Measure the router and index groundedness (`npm run eval`).
- Keep the surface small enough to run and explain.

## User stories

1. I upload a `.txt` file and ask a question about it. The system retrieves chunks and answers from those chunks when they are relevant.
2. I ask for a current-world fact. The system uses web search instead of the file index.
3. I send a greeting or simple math. The system answers without retrieval or search.
4. I see each hop (`route`, `retrieve`, `grade`, `rewrite`, `webSearch`, `generate`) next to the answer, plus sources and timing.
5. I run `npm run eval` and get pass/fail per expected route, plus a groundedness score on index answers.
6. I can see indexed files in the sidebar and remove an upload.

## Functional requirements

| ID | Requirement |
| --- | --- |
| FR-1 | Classify each question as `index`, `search`, or `general` using structured output. |
| FR-2 | `index` retrieves Qdrant chunks with hybrid search (vector + keyword, RRF). If the question names an uploaded `.txt`, those chunks are used first. |
| FR-3 | A grade node marks retrieved chunks relevant or not. A named-file hit is relevant even if the question also asks for live web facts. |
| FR-4 | If not relevant and `rewriteCount < 1`, rewrite the question and retrieve again. |
| FR-5 | If still not relevant, fall back to web search, then generate. Web search keeps earlier file chunks. Mixed file + live questions also search after a relevant retrieve. |
| FR-6 | `search` calls Tavily and then generate. |
| FR-7 | `general` answers with the chat model only. |
| FR-8 | Accept `.txt` uploads; split at about 1000 characters with 150 overlap; persist in Qdrant. Same filename overwrites the previous copy; identical content is not indexed again. |
| FR-9 | Seed every `.txt` in `data/sample/` if that filename is not already in Qdrant. |
| FR-10 | Query API returns `{ answer, route, trace, sources, metrics }`. |
| FR-11 | UI shows the three pipelines, upload, chat, path chips, sources, and hop timing. |
| FR-12 | Chat turns and session metadata are stored in MongoDB by `sessionId`. |
| FR-13 | The browser keeps `sessionId` in `localStorage` so refresh restores the conversation. |
| FR-14 | Classify, generate, and general receive recent conversation history. |
| FR-15 | Sidebar lists indexed files. Uploads can be deleted from Qdrant and disk. The sample file cannot. |
| FR-16 | Index answers are checked for groundedness in `npm run eval`. |
| FR-17 | Chat and embeddings use OpenAI, or Azure OpenAI when those env vars are set. |

## Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-1 | TypeScript throughout. |
| NFR-2 | Node.js runtime for API routes (filesystem + LangChain). |
| NFR-3 | Secrets only in `.env.local`, never committed. |
| NFR-4 | Rewrite budget is one; no unbounded loops. |
| NFR-5 | Eval is deterministic in *expected route*. Groundedness is lexical overlap against retrieved chunks. |
| NFR-6 | CI runs `tsc` and lint. |

## Out of scope (v1)

- Login and authentication
- PDF or other binary formats
- ReAct / multi-agent roleplay
- Rate limits, multi-tenant isolation, packaging the Next app in Docker
- Hosted public demo

MongoDB and Qdrant are in scope (see [decision.md](../decision.md) D-014, D-015). `docker-compose.yml` only runs those two services.
