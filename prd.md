# PRD: Adaptive RAG

| Field | Value |
| --- | --- |
| Product | Adaptive RAG (TypeScript) |
| Status | v1 shipped |
| Audience | Recruiter / hiring manager, engineer reviewing the repo, future you |
| Related | [tech-stack.md](tech-stack.md), [decision.md](decision.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

This is the product spec. Engineering IDs (FR-*) live in [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md). If they disagree, update both.

---

## 1. Problem

Most “chat with my files” demos do one of two things:

- Always call the model (no retrieval, weak on private docs)
- Always retrieve (waste on “hello”, stale on live news)

Neither shows **control**. An Adaptive RAG product should pick a path per question, check retrieved text, and show that path.

## 2. Who it is for

| User | Need |
| --- | --- |
| Demo user | Upload a `.txt`, ask a question, see an answer and the path |
| Engineer / interviewer | Explain routing, grade, rewrite budget, and eval numbers |
| Future maintainer | Know what v1 promised and what it refused |

## 3. Product goals

1. Route each question to **index**, **search**, or **general**.
2. Use documents only when chunks pass a relevance grade.
3. Bound cost: **one rewrite**, then web search.
4. Make the path visible in the UI (`trace` chips).
5. Prove the router with a fixed eval set (`npm run eval`).
6. Persist chat in MongoDB so refresh does not wipe the conversation.
7. Store document vectors in Qdrant.

## 4. Non-goals (v1)

- Accounts, login, or multi-user isolation (session ID in the browser is enough)
- PDF / Office upload
- Multi-agent roleplay (CEO / researcher personas)
- Production rate limits, billing, or packaging the Next.js app in Docker

v1 is Adaptive RAG with three pipelines, Qdrant retrieval, and MongoDB sessions. It is not a full clone of the Python Adaptive-Rag UI/auth stack.

## 5. Experience

### Happy path

1. Open the app. Sample knowledge base (`data/sample/azure-ai.txt`) is indexed into Qdrant on first use. Chat loads from MongoDB if this browser already has a session.
2. Optional: upload a `.txt`; it is chunked and indexed in Qdrant.
3. Ask a question. Classification picks **Index**, **General**, or **Search**.
4. See the pipeline badge plus chips such as `route=index → retrieve=4 → grade=yes → generate`.
5. Refresh: bubbles come back. Indexed files stay in Qdrant.

### Paths

| User intent | Product path |
| --- | --- |
| Question about uploaded or sample docs | `index` → retrieve → grade → (rewrite once if needed) → generate or web fallback |
| Live / current-world fact | `search` → Tavily → generate |
| Greeting, small talk, simple math | `general` → model only |

### Failure behavior

| Failure | Product behavior |
| --- | --- |
| Empty or non-`.txt` upload | Clear error; no index change |
| Missing `OPENAI_API_KEY` | Query fails with a setup message |
| Missing `TAVILY_API_KEY` | Web hop explains search is not configured; no crash |
| Weak chunks after one rewrite | Fall back to web, then generate |
| Generator has no useful context | Say it does not know; do not invent sources |

## 6. Features (v1)

| Feature | Description | Success |
| --- | --- | --- |
| Query router | Structured `index \| search \| general` | Eval cases hit expected route; UI names the three pipelines |
| Document index | `.txt` upload, ~1000 / 150 chunking, Qdrant | Upload then ask a fact from that file |
| Relevance grade | Independent of search tools | Trace shows `grade=yes` or `grade=no` |
| Rewrite budget | At most one rewrite | Trace never shows two `rewrite` hops |
| Web search | Tavily when routed or as fallback | Search questions leave the index path |
| General answers | No retrieval | Greetings do not call retrieve |
| Path UI | Pipeline badge + `trace` chips | Reviewer can narrate the graph without logs |
| Sessions | MongoDB messages + `localStorage` session id | Refresh restores chat |
| Router eval | 10 cases, expected vs actual route | `npm run eval` prints a table |

## 7. Success metrics

| Metric | v1 bar |
| --- | --- |
| Router accuracy | Report N/10 from `npm run eval`; do not ship a story without this number |
| Trace completeness | Every answer shows the hops that ran |
| Bounded loops | `rewriteCount` never exceeds 1 |
| Time-to-demo | Clone, env keys, `npm run dev`, one index question, one search question, one general question |

v1 does **not** claim groundedness of every sentence. That is a later eval layer (see [docs/EVALUATION.md](docs/EVALUATION.md)).

## 8. Constraints

- Language: TypeScript
- App: one Next.js project (UI + API)
- Secrets: `.env.local` only
- Models: OpenAI chat + embeddings (defaults in `.env.example`)
- Vectors: Qdrant
- Chat: MongoDB by `sessionId` (no login)

## 9. Milestones

| Milestone | Status |
| --- | --- |
| Graph: classify, retrieve, grade, rewrite, web, generate | Done |
| Three pipelines visible in UI (Index / General / Search) | Done |
| Upload + sample seed into Qdrant | Done |
| MongoDB session history + conversation context | Done |
| Router eval (10 cases) | Done |
| Product + stack + decision docs | Done |
| Azure OpenAI swap | Not started (client-only; see [decision.md](decision.md) D-006) |
| PDF ingest | Out of scope until PRD changes |

## 10. Open questions

Record answers in [decision.md](decision.md), do not only edit this list.

- [ ] Switch chat/embeddings to Azure OpenAI for the Azure story?
- [ ] Add a second eval: quote-in-chunk check for `index` answers?

---

When you add a feature, update this PRD, [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md), and append a row in [decision.md](decision.md).
