# Decision log

I keep architecture choices here so I do not lose the why. Old entries stay. If I change my mind I mark the old one superseded and add a new ID.

Product: [prd.md](prd.md). Stack: [tech-stack.md](tech-stack.md). Graph: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). [`docs/DECISIONS.md`](docs/DECISIONS.md) only points here.

Next ID: **D-021**.

---

## Index

| ID | Date | Status | Decision |
| --- | --- | --- | --- |
| D-020 | 2026-09-07 | Accepted | Optional Azure OpenAI client + CI for tsc and lint |
| D-019 | 2026-09-07 | Accepted | Groundedness eval, citations, and hop metrics |
| D-018 | 2026-09-07 | Accepted | Hybrid retrieve and sidebar file list/delete |
| D-017 | 2026-09-07 | Accepted | Re-upload of the same `.txt` replaces, does not stack |
| D-016 | 2026-09-07 | Accepted | Named-file retrieve + keep file chunks on web fallback |
| D-001 | 2026-09-06 | Accepted | One Next.js TypeScript app, not FastAPI + Streamlit |
| D-002 | 2026-09-06 | Accepted | LangGraph.js `StateGraph` for Adaptive RAG |
| D-003 | 2026-09-06 | Accepted | Three routes only: index, search, general |
| D-004 | 2026-09-06 | Accepted | Grade cannot search; rewrite budget is one |
| D-005 | 2026-09-06 | Superseded by D-014 | `MemoryVectorStore` + `data/store.json` |
| D-006 | 2026-09-06 | Accepted | OpenAI + Tavily for v1, not Azure |
| D-007 | 2026-09-06 | Superseded by D-015 | In-memory chat history by `sessionId` |
| D-008 | 2026-09-06 | Accepted | Eval measures router, not answer prose |
| D-009 | 2026-09-06 | Accepted | Graph node `classify` (state key stays `route`) |
| D-010 | 2026-09-06 | Accepted | `Annotation.Root` for graph state, Zod for structured output |
| D-011 | 2026-09-06 | Accepted | `.txt` only; no PDF in v1 |
| D-012 | 2026-09-06 | Accepted | Seed from `data/sample/azure-ai.txt` when the store is empty |
| D-013 | 2026-09-07 | Accepted | Product docs: `prd.md`, `tech-stack.md`, this log |
| D-014 | 2026-09-07 | Accepted | Qdrant is the vector store |
| D-015 | 2026-09-07 | Accepted | MongoDB persists sessions and full chat history |

---

## Entries

### D-020: Optional Azure OpenAI client + CI for tsc and lint

| | |
| --- | --- |
| Date | 2026-09-07 |
| Status | Accepted |
| Area | stack |

**Context:** I wanted Azure OpenAI as a switch, not a rewrite. I also wanted typecheck and lint on every push.

**Decision:** `src/lib/llm.ts` uses `AzureChatOpenAI` / `AzureOpenAIEmbeddings` when Azure env vars are set; otherwise OpenAI. `.github/workflows/ci.yml` runs `tsc` and lint. Eval stays local because it needs model keys.

**Why:** Same graph either way. CI does not spend API credits.

---

### D-019: Groundedness eval, citations, and hop metrics

| | |
| --- | --- |
| Date | 2026-09-07 |
| Status | Accepted |
| Area | eval |

**Context:** Router accuracy alone does not catch an index answer that ignores the chunks. I also could not see how expensive a hop was.

**Decision:** `npm run eval` scores index claims against retrieved text. Generate attaches source names. Each node records elapsed ms (and tokens when the API returns them). The UI shows both.

**Why:** I can say whether the answer is grounded and how long the path took.

---

### D-018: Hybrid retrieve and sidebar file list/delete

| | |
| --- | --- |
| Date | 2026-09-07 |
| Status | Accepted |
| Area | graph |

**Context:** Vector-only search missed short files and exact names. I also had no way to see or remove what was indexed.

**Decision:** Default retrieve fuses Qdrant vector hits with a keyword scroll on `content` (RRF). Named `.txt` files still win. GET/DELETE `/api/sources` lists files and removes uploads.

**Why:** Hybrid search matches how I describe Azure AI Search hybrid in the sample file. The sidebar is the index, not just a folder on disk.

---

### D-017: Re-upload of the same `.txt` replaces, does not stack

| | |
| --- | --- |
| Date | 2026-09-07 |
| Status | Accepted |
| Area | product |

**Context:** Each Index click wrote `data/uploads/{timestamp}-{name}` and inserted new Qdrant points. `bodymeasurements.txt` appeared three times with the same content.

**Options:** Keep every version; skip identical content and keep one disk file per name; add a versions UI.

**Decision:** Save as `data/uploads/{filename}`. If that name is already indexed with the same text, skip embedding. If the text changed, replace the old upload vectors. Collapse leftover timestamped copies.

**Why:** The folder and the vector store should show what the user indexed, not how many times they clicked.

**Follow-up:** `src/lib/rag/store.ts` `saveUpload` / `reconcileUploads`.

---

### D-016: Named-file retrieve + keep file chunks on web fallback

| | |
| --- | --- |
| Date | 2026-09-07 |
| Status | Accepted |
| Area | graph |

**Context:** A user indexed `bodymeasurements.txt` and asked to summarise it plus San Francisco weather. Similarity search used the full mixed question, returned Azure sample chunks, graded them irrelevant, then web search replaced the document list. The model said it did not know the file.

**Options:** Fourth hybrid route; filename-aware retrieve and merge on web search; leave single-vector retrieve as-is.

**Decision:** If the question names an indexed `.txt`, retrieve those chunks first. A named-file hit is relevant. Mixed file + live questions still web-search after grade. Web search appends snippets and keeps earlier file chunks. Still three routes (D-003).

**Why:** The file was already in Qdrant. The failure was retrieve + replace, not missing index.

**Follow-up:** `src/lib/rag/store.ts`, `src/lib/graph/nodes.ts`.

---

### D-015: MongoDB persists sessions and full chat history

| | |
| --- | --- |
| Date | 2026-09-07 |
| Status | Accepted |
| Area | stack |

**Context:** Refresh wiped chat. In-memory `Map` was not a session. Product now requires persistent history and conversation context.

**Options:** `localStorage` only; MongoDB; SQLite.

**Decision:** MongoDB collections `sessions` and `messages`. Browser keeps `sessionId` in `localStorage`. Classify / generate / general receive recent history. No login: one ID per browser until “New conversation”.

**Why:** Matches the requested state management. Follow-ups like “what about hybrid search?” can route to `index`.

**Follow-up:** Requires `MONGODB_URI`. Run `docker compose up -d mongo`.

---

### D-014: Qdrant is the vector store

| | |
| --- | --- |
| Date | 2026-09-07 |
| Status | Accepted |
| Area | stack |

**Context:** Product requirement changed from in-process vectors to Qdrant, as in the Python Adaptive-Rag reference.

**Options:** Keep JSON + RAM; Qdrant; Azure AI Search.

**Decision:** `@langchain/qdrant` `QdrantVectorStore`. Collection created on first use. Sample file seeded when the collection is empty. Raw `.txt` copies still go to `data/uploads/`.

**Why:** Same retrieve node, durable vectors, ready for more documents.

**Follow-up:** Requires `QDRANT_URL`. Run `docker compose up -d qdrant`. Supersedes D-005.

---

### D-013: Product docs live at repo root as PRD, tech stack, and this log

| | |
| --- | --- |
| Date | 2026-09-07 |
| Status | Accepted |
| Area | docs |

**Context:** The repo had architecture/requirements notes, but no single PRD, stack inventory, or append-only decision history.

**Options:** Only `docs/`; three new root files; wiki.

**Decision:** Add [`prd.md`](prd.md), [`tech-stack.md`](tech-stack.md), and this [`decision.md`](decision.md). Keep `docs/` for architecture, evaluation, and FR-IDs.

**Why:** I want the product, stack, and decisions at the repo root. A log I update as I go is more useful than a frozen ADR dump.

**Follow-up:** New product or stack choices must land here the same day.

---

### D-012: Seed the sample knowledge base when the store is empty

| | |
| --- | --- |
| Date | 2026-09-06 |
| Status | Accepted |
| Area | product |

**Context:** A first run that requires a manual upload is a weak demo.

**Decision:** If `data/store.json` is empty, index [`data/sample/azure-ai.txt`](data/sample/azure-ai.txt) on first retrieve.

**Why:** Index eval cases and the suggested UI question work with zero extra clicks.

**Follow-up:** Changing the sample file means updating `eval/cases.json`.

---

### D-011: Accept `.txt` uploads only

| | |
| --- | --- |
| Date | 2026-09-06 |
| Status | Accepted |
| Area | product |

**Context:** The Python reference uploads PDF. PDF parsing is a separate product.

**Decision:** API rejects non-`.txt`. Error copy is factual (“Only .txt files are supported.”).

**Why:** Chunking and eval stay deterministic. PDF is an explicit later PRD change.

**Follow-up:** Supersede this if Document Intelligence or a PDF loader is added.

---

### D-010: `Annotation.Root` for state; Zod for node outputs

| | |
| --- | --- |
| Date | 2026-09-06 |
| Status | Accepted |
| Area | graph |

**Context:** LangGraph.js also offers `StateSchema` (Zod-native). Chat structured output already uses Zod 3.

**Options:** `StateSchema` for everything; `Annotation.Root` + Zod only on LLM outputs.

**Decision:** Graph state via `Annotation.Root` in `src/lib/graph/state.ts`. Classify / grade / rewrite via `withStructuredOutput` + Zod.

**Why:** Avoid mixing Zod 3/4 `StateSchema` constraints with the OpenAI structured-output path. `trace` still appends through a reducer.

**Follow-up:** Revisit if the project standardizes on Zod 4 `StateSchema`.

---

### D-009: Name the router node `classify`

| | |
| --- | --- |
| Date | 2026-09-06 |
| Status | Accepted |
| Area | graph |

**Context:** First compile failed: `route is already being used as a state attribute, cannot also be used as a node name.`

**Decision:** State field remains `route`. Node name is `classify`. `runAdaptiveRag` still returns `route`.

**Why:** LangGraph channels and node names share a namespace. The public API should still say `route=index`.

**Follow-up:** Never add a node named `question`, `documents`, `trace`, `answer`, or `route`.

---

### D-008: Eval measures the router, not answer prose

| | |
| --- | --- |
| Date | 2026-09-06 |
| Status | Accepted |
| Area | eval |

**Context:** Scoring free-text answers needs a judge model and is noisy.

**Decision:** Ten cases in `eval/cases.json` with `expectedRoute`. `npm run eval` compares `result.route`.

**Why:** Fast, cheap, and honest. Groundedness of sentences is a later layer.

**Follow-up:** Open question in the PRD: quote-in-chunk check for index answers.

---

### D-007: In-memory session history only

| | |
| --- | --- |
| Date | 2026-09-06 |
| Status | Accepted |
| Area | stack |

**Context:** MongoDB chat history exists in the Python reference. Durable history is not required to prove Adaptive RAG.

**Decision:** Process-local `Map` keyed by `sessionId`, last 20 turns.

**Why:** History is UI/API convenience. The graph still runs per question.

**Follow-up:** Lost on restart. Supersede if a real product needs persistence.

---

### D-006: OpenAI + Tavily for v1, not Azure

| | |
| --- | --- |
| Date | 2026-09-06 |
| Status | Accepted |
| Area | stack |

**Context:** Azure OpenAI would match an Azure AI fundamentals story. The first working build used the OpenAI API.

**Decision:** `ChatOpenAI` + `OpenAIEmbeddings`. Tavily for web. If Tavily is unset, the web node returns a “not configured” snippet.

**Why:** Fewer moving parts to get the graph running. Azure is a client swap in `src/lib/llm.ts`, not a graph rewrite.

**Follow-up:** Open question in the PRD. If accepted later, add D-0xx and update `tech-stack.md`.

---

### D-005: MemoryVectorStore plus `data/store.json`

| | |
| --- | --- |
| Date | 2026-09-06 |
| Status | Accepted |
| Area | stack |

**Context:** Qdrant matches the Python repo but needs extra infra. Process memory dies on refresh.

**Decision:** In-process `MemoryVectorStore`. Persist `{ pageContent, metadata }` to `data/store.json` and rebuild embeddings when needed.

**Why:** Local demo without Docker. Restart re-embeds a small corpus.

**Follow-up:** Not a production vector DB. Supersede if Qdrant / Azure AI Search is added.

---

### D-004: Grade cannot search; rewrite budget is one

| | |
| --- | --- |
| Date | 2026-09-06 |
| Status | Accepted |
| Area | graph |

**Context:** If the grader can search, it is no longer independent. Unlimited rewrite loops waste tokens.

**Decision:** Grade is read-only. At most one rewrite (`rewriteCount < 1`), then web search.

**Why:** Bounded cost. Grade stays independent of search.

**Follow-up:** Trace must never contain two `rewrite` hops. If you see that, it is a bug, not a new decision.

---

### D-003: Three routes only (index, search, general)

| | |
| --- | --- |
| Date | 2026-09-06 |
| Status | Accepted |
| Area | product |

**Context:** Extra routes look like a bigger agent. They make eval fuzzy.

**Decision:** Exactly three: documents, live web, model-only.

**Why:** Each eval case maps to one expected route. Router prompt lists sample-file topics so index stays stable.

**Follow-up:** A fourth route needs new eval cases and a PRD edit.

---

### D-002: LangGraph.js StateGraph for Adaptive RAG

| | |
| --- | --- |
| Date | 2026-09-06 |
| Status | Accepted |
| Area | graph |

**Context:** Adaptive RAG is branching (route, grade, rewrite, fallback), not one prompt.

**Options:** Hand-rolled if/else; LangChain runnable sequence; LangGraph `StateGraph`.

**Decision:** LangGraph.js `StateGraph` with conditional edges.

**Why:** The path is explicit, drawable, and matches how production agent graphs are described.

**Follow-up:** Implementation lives in `src/lib/graph/`.

---

### D-001: One Next.js app instead of a split API and UI

| | |
| --- | --- |
| Date | 2026-09-06 |
| Status | Accepted |
| Area | stack |

**Context:** The Python reference uses FastAPI + Streamlit. TypeScript was a product constraint.

**Options:** Next.js App Router; Express/Hono API + separate frontend.

**Decision:** One Next.js TypeScript app.

**Why:** Shared types, one `npm run dev`. API routes use the Node runtime because of filesystem + LangChain.

**Follow-up:** Do not split the repo unless D-001 is superseded.
