# PRD: Adaptive RAG

| Field | Value |
| --- | --- |
| Product | Adaptive RAG (TypeScript) |
| Status | v1 |
| Related | [tech-stack.md](tech-stack.md), [decision.md](decision.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

Engineering IDs (FR-*) live in [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md). If they disagree, update both.

---

## 1. Problem

Most “chat with my files” apps do one of two things:

- Always call the model (no retrieval, weak on private docs)
- Always retrieve (waste on “hello”, stale on live news)

Neither shows control. This app picks a path per question, checks retrieved text, and shows that path.

## 2. Who it is for

| User | Need |
| --- | --- |
| Person using the app | Upload a `.txt`, ask a question, see an answer and the path |
| Person reading the repo | Understand routing, grade, rewrite budget, and eval numbers |

## 3. Product goals

1. Route each question to **index**, **search**, or **general**.
2. Use documents only when chunks pass a relevance grade.
3. Bound cost: **one rewrite**, then web search.
4. Make the path, sources, and hop timing visible.
5. Measure the router and index groundedness (`npm run eval`).
6. Persist chat in MongoDB so refresh does not wipe the conversation.
7. Store document vectors in Qdrant, with hybrid retrieve.

## 4. Non-goals (v1)

- Accounts, login, or multi-user isolation (session ID in the browser is enough)
- PDF / Office upload
- Multi-agent roleplay
- Production rate limits, billing, or packaging the Next.js app in Docker
- Hosted public demo

v1 is Adaptive RAG with three pipelines, Qdrant retrieval, and MongoDB sessions. It is not a full clone of the Python Adaptive-Rag UI/auth stack.

## 5. Experience

### Happy path

1. Open the app. Sample knowledge base (`data/sample/azure-ai.txt`) is indexed into Qdrant on first use. Chat loads from MongoDB if this browser already has a session.
2. Optional: upload a `.txt`; it is chunked and indexed in Qdrant. The sidebar lists indexed files. Re-uploading the same name replaces the old copy.
3. Ask a question. Classification picks **Index**, **General**, or **Search**.
4. See the pipeline badge, path chips, sources, and hop timing.
5. Refresh: bubbles come back. Indexed files stay in Qdrant.

### Paths

| User intent | Product path |
| --- | --- |
| Question about uploaded or sample docs | `index` → hybrid retrieve (named file first) → grade → (rewrite once if needed) → generate or web fallback |
| File question plus a live fact | `index` → retrieve named file → keep those chunks → web search → generate |
| Live / current-world fact | `search` → Tavily → generate |
| Greeting, small talk, simple math | `general` → model only |

### Failure behavior

| Failure | Product behavior |
| --- | --- |
| Empty or non-`.txt` upload | Clear error; no index change |
| Missing model key | Query fails with a setup message |
| Missing `TAVILY_API_KEY` | Web hop explains search is not configured; no crash |
| Weak chunks after one rewrite | Fall back to web, then generate |
| Generator has no useful context | Say it does not know; do not invent sources |

## 6. Features (v1)

| Feature | Description | Success |
| --- | --- | --- |
| Query router | Structured `index \| search \| general` | Eval cases hit expected route |
| Document index | `.txt` upload, ~1000 / 150 chunking, Qdrant | Upload then ask a fact from that file |
| File list / delete | Sidebar shows indexed files; uploads can be removed | Delete drops Qdrant points and the disk copy |
| Hybrid retrieve | Vector + keyword, RRF fuse | Filenames and rare tokens still match |
| Relevance grade | Independent of search tools | Trace shows `grade=yes` or `grade=no` |
| Rewrite budget | At most one rewrite | Trace never shows two `rewrite` hops |
| Web search | Tavily when routed or as fallback | Search questions leave the index path |
| Citations | Source filenames / URLs on the answer | Index and search answers show sources |
| Hop metrics | Time (and tokens when the API returns them) per node | Shown under the path chips |
| General answers | No retrieval | Greetings do not call retrieve |
| Path UI | Pipeline badge + `trace` chips | The graph is visible without logs |
| Sessions | MongoDB messages + `localStorage` session id | Refresh restores chat |
| Eval | 10 router cases + index groundedness | `npm run eval` prints both scores |

## 7. Success metrics

| Metric | v1 bar |
| --- | --- |
| Router accuracy | Report N/10 from `npm run eval` |
| Index groundedness | Report supported / total claims on index cases |
| Trace completeness | Every answer shows the hops that ran |
| Bounded loops | `rewriteCount` never exceeds 1 |
| Time-to-run | Clone, env keys, `npm run dev`, one index / search / general question |

## 8. Constraints

- Language: TypeScript
- App: one Next.js project (UI + API)
- Secrets: `.env.local` only
- Models: OpenAI by default; Azure OpenAI if those env vars are set (`src/lib/llm.ts`)
- Vectors: Qdrant
- Chat: MongoDB by `sessionId` (no login)

## 9. Milestones

| Milestone | Status |
| --- | --- |
| Graph: classify, retrieve, grade, rewrite, web, generate | Done |
| Three pipelines visible in UI | Done |
| Upload + sample seed into Qdrant | Done |
| MongoDB session history | Done |
| Router eval (10 cases) | Done |
| Hybrid retrieve + file list/delete | Done |
| Groundedness eval, citations, hop metrics | Done |
| Optional Azure OpenAI client | Done |
| CI (`tsc` + lint) | Done |
| PDF ingest | Out of scope until this PRD changes |

---

When I add a feature I update this PRD, [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md), and [decision.md](decision.md).
