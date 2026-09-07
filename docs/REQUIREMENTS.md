# Requirements

Engineering IDs for Adaptive RAG. The product spec is [prd.md](../prd.md). Stack: [tech-stack.md](../tech-stack.md). Decisions: [decision.md](../decision.md).

## Problem

A single chat model either invents sources or always retrieves documents, even when the question is a greeting or needs live news. This project routes each question to the right path and only generates from context that passed a relevance check.

## Goals

- Answer questions from uploaded text, the live web, or the model alone.
- Show the graph path so a reviewer can see *why* that path ran.
- Measure the router with a fixed eval set (`npm run eval`).
- Keep the surface small enough to demo and explain in an interview.

## User stories

1. As a user, I upload a `.txt` file and ask a question about it. The system retrieves chunks and answers from those chunks when they are relevant.
2. As a user, I ask for a current-world fact. The system uses web search instead of the file index.
3. As a user, I send a greeting or simple math. The system answers without retrieval or search.
4. As a user, I see each hop (`route`, `retrieve`, `grade`, `rewrite`, `webSearch`, `generate`) next to the answer.
5. As a developer, I run `npm run eval` and get pass/fail per expected route.

## Functional requirements

| ID | Requirement |
| --- | --- |
| FR-1 | Classify each question as `index`, `search`, or `general` using structured output. |
| FR-2 | `index` retrieves top-k chunks from Qdrant. |
| FR-3 | A grade node marks retrieved chunks relevant or not. |
| FR-4 | If not relevant and `rewriteCount < 1`, rewrite the question and retrieve again. |
| FR-5 | If still not relevant, fall back to web search, then generate. |
| FR-6 | `search` calls Tavily and then generate. |
| FR-7 | `general` answers with the chat model only. |
| FR-8 | Accept `.txt` uploads; split at about 1000 characters with 150 overlap; persist in Qdrant. |
| FR-9 | If the Qdrant collection is empty, seed from `data/sample/azure-ai.txt`. |
| FR-10 | Query API returns `{ answer, route, trace }`. |
| FR-11 | UI shows the three pipelines, upload, chat, and path chips. |
| FR-12 | Chat turns and session metadata are stored in MongoDB by `sessionId`. |
| FR-13 | The browser keeps `sessionId` in `localStorage` so refresh restores the conversation. |
| FR-14 | Classify, generate, and general receive recent conversation history. |

## Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-1 | TypeScript throughout. |
| NFR-2 | Node.js runtime for API routes (filesystem + LangChain). |
| NFR-3 | Secrets only in `.env.local`, never committed. |
| NFR-4 | Rewrite budget is one; no unbounded loops. |
| NFR-5 | Eval is deterministic in *expected route*, not in free-text answers. |

## Out of scope (v1)

- Login and authentication
- PDF or other binary formats
- ReAct / multi-agent “company” roleplay
- Rate limits, multi-tenant isolation, packaging the Next app in Docker

MongoDB and Qdrant **are** in scope (see [decision.md](../decision.md) D-014, D-015). `docker-compose.yml` only runs those two services.
