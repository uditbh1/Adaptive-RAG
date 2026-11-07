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
6. I can see sample files and this account’s uploads in the sidebar and remove an upload.
7. I can force My files or Web only, or lock answers to one indexed file.
8. Every answer shows whether it came from my files, the web, both, or the model alone. File answers include a short quote.

## Functional requirements

| ID | Requirement |
| --- | --- |
| FR-1 | In Auto, hybrid-search this account's files and the sample corpus first. If the grade says those chunks state the asked fact, the route is `index`. Otherwise classify `search` or `general`. My files and Web only skip that peek. |
| FR-2 | `index` retrieves Qdrant chunks with hybrid search (vector + keyword, RRF), filtered to sample files plus the signed-in `userId`. Another account’s uploads are not searched. If the question names an uploaded `.txt` this account has, those chunks are used first. |
| FR-3 | A grade node marks retrieved chunks relevant or not. A named-file hit is relevant even if the question also asks for live web facts. |
| FR-4 | On My files, if the grade says the chunks are not useful and `rewriteCount < 1`, rewrite the question and retrieve again. Auto does not rewrite after a failed peek. |
| FR-5 | On Auto, a failed peek chooses `search` or `general` and does not open the index again. A useful peek that also needs a live fact goes to web search and keeps the file chunks. My files never calls Tavily. |
| FR-6 | `search` calls Tavily and then generate. |
| FR-7 | `general` answers with the chat model only. |
| FR-8 | Accept `.txt` uploads for a signed-in user; split at about 1000 characters with 150 overlap; persist in Qdrant tagged with `userId`. Same filename overwrites that account’s previous copy; identical content for that account is not indexed again. |
| FR-9 | Seed every `.txt` in `data/sample/` if that filename is not already in Qdrant. |
| FR-10 | Query API accepts `{ query, sessionId, mode, lockedFile }` from a signed-in user and returns `{ answer, route, trace, sources, metrics, provenance }`. `mode` defaults to Auto. `userId` comes from the session cookie. |
| FR-11 | UI shows Auto / My files / Web only, file lock, provenance banner, quote, path chips, sources, and hop timing. |
| FR-12 | Chat turns and session metadata are stored in MongoDB by `userId` and `sessionId`. History loaded for classify/generate is that account’s session only. |
| FR-13 | Signup and login use email and a password. The server sets an httpOnly session cookie. `GET /api/sessions` returns that account’s chats. Upload, source list, delete, and retrieve use the cookie’s `userId`. Sample files stay shared. |
| FR-14 | Classify, generate, and general receive recent conversation history. |
| FR-15 | Sidebar lists sample files plus this account’s uploads. Uploads can be deleted from Qdrant (and disk if present). Sample files cannot. Clicking a file locks retrieve to that source. |
| FR-16 | Index answers are checked for groundedness in `npm run eval`. |
| FR-17 | Chat and embeddings use OpenAI, or Azure OpenAI when those env vars are set. |
| FR-18 | My files skips the classifier, retrieves (optionally one locked file), and generates or refuses. It does not call Tavily or answer from general knowledge. |
| FR-19 | Web only skips retrieve and goes to Tavily, then generate. |

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

- Email verification, password reset, and OAuth
- PDF or other binary formats
- ReAct / multi-agent roleplay
- Rate limits, multi-tenant isolation, packaging the Next app in Docker
- Hosted public demo

MongoDB and Qdrant are in scope (see [decision.md](../decision.md) D-014, D-015). `docker-compose.yml` only runs those two services.
