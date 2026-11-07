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

Neither shows control. This app picks a path per question, checks retrieved text, and lets you force files or the web. Every answer says where it came from.

## 2. Who it is for

| User | Need |
| --- | --- |
| Person using the app | Upload a `.txt`, ask a question, see an answer and the path |
| Person reading the repo | Understand routing, grade, rewrite budget, and eval numbers |

## 3. Product goals

1. Route each question to **index**, **search**, or **general** (Auto), or honour **My files** / **Web only**.
2. On Auto, use this account’s files when a peek shows the chunks state the fact. My files still grades retrieved text.
3. Bound cost: Auto peeks once and does not rewrite. My files may rewrite once and never calls the web.
4. Make provenance, path, sources, and hop timing visible.
5. Measure the router and index groundedness (`npm run eval`).
6. Persist chat in MongoDB so refresh does not wipe the conversation.
7. Store document vectors in Qdrant, with hybrid retrieve.

## 4. Non-goals (v1)

- PDF / Office upload
- Multi-agent roleplay
- Production rate limits, billing, or packaging the Next.js app in Docker
- Hosted public demo

v1 is Adaptive RAG with three pipelines, Qdrant retrieval, and MongoDB sessions. It is not a full clone of the Python Adaptive-Rag UI/auth stack.

## 5. Experience

### Happy path

1. Sign up or sign in. The sample knowledge base is indexed into Qdrant on first use. This account’s chats load from MongoDB.
2. Optional: upload a `.txt`; it is chunked and indexed in Qdrant for this account. The sidebar lists sample files plus this account’s uploads. Re-uploading the same name replaces that account’s copy.
3. Optional: pick Auto, My files, or Web only. Click a sidebar file to lock answers to that file.
4. Ask a question. On Auto, the app peeks at this account’s files and the sample corpus. Useful chunks take the **Index** path. Otherwise it picks **Search** or **General**. My files and Web only skip that peek.
5. See a provenance banner (files / web / mixed / model), a short file quote when the answer came from docs, plus path chips, sources, and hop timing.
6. Refresh: bubbles come back. Indexed files stay in Qdrant.

### Paths

| User intent | Product path |
| --- | --- |
| Auto: question answered by this account’s files or the samples | peek → grade yes → `index` context → generate |
| Auto: those chunks answer, and the question also needs a live fact | peek → keep those chunks → web search → generate |
| Auto: files do not state the fact, and it needs the live web | peek → grade no → `search` → Tavily → generate |
| Auto: greeting, small talk, simple math | peek → grade no → `general` → model only |
| My files (optional lock to one file) | always `index`; retrieve that file or all files; one rewrite if weak; never Tavily |
| Web only | always `search` → Tavily → generate |

### Failure behavior

| Failure | Product behavior |
| --- | --- |
| Empty or non-`.txt` upload | Clear error; no index change |
| Missing model key | Query fails with a setup message |
| Missing `TAVILY_API_KEY` | Web hop explains search is not configured; no crash |
| Weak chunks after one rewrite | Auto: fall back to web, then generate. My files: generate/refuse from file chunks only |
| Generator has no useful context | Say it does not know; do not invent sources |

## 6. Features (v1)

| Feature | Description | Success |
| --- | --- | --- |
| Query router | Structured `index \| search \| general` | Eval cases hit expected route |
| Document index | `.txt` upload, ~1000 / 150 chunking, Qdrant | Upload then ask a fact from that file |
| File list / delete | Sidebar shows sample files plus this account’s uploads; uploads can be removed | Delete drops that account’s Qdrant points (and the disk copy if present) |
| Hybrid retrieve | Vector + keyword, RRF fuse | Filenames and rare tokens still match |
| Relevance grade | Independent of search tools | Trace shows `grade=yes` or `grade=no` |
| Rewrite budget | At most one rewrite | Trace never shows two `rewrite` hops |
| Web search | Tavily when routed or as fallback | Search questions leave the index path |
| Citations | Source filenames / URLs on the answer | Index and search answers show sources |
| Hop metrics | Time (and tokens when the API returns them) per node | Shown under the path chips |
| General answers | No retrieval | Greetings do not call retrieve |
| Answer modes | Auto / My files / Web only at send time | Files-only never hits Tavily; Web only skips retrieve |
| File lock | Click a sidebar file to retrieve that source only | Answers stay on that filename until unlocked |
| Provenance | Banner + optional file quote on every assistant turn | User can tell files vs web vs model |
| Path UI | Pipeline badge + `trace` chips | The graph is visible without logs |
| Accounts | Email and password. Session cookie. Chats and uploads stored by `userId` | Another account cannot list or retrieve them |
| Sessions | MongoDB messages for the signed-in user. The open chat id may stay in `localStorage` | Sidebar and refresh show this account’s chats |
| Eval | 60 router cases, phrase checks, and index groundedness | `npm run eval` prints all three scores |

## 7. Success metrics

| Metric | v1 bar |
| --- | --- |
| Router accuracy | Report N/60 from `npm run eval` |
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
- Chat: MongoDB by `userId` and `sessionId`
- Uploads: Qdrant points tagged with the signed-in `userId`
- Auth: email, scrypt password hash, httpOnly session cookie

## 9. Milestones

| Milestone | Status |
| --- | --- |
| Graph: classify, retrieve, grade, rewrite, web, generate | Done |
| Three pipelines visible in UI | Done |
| Upload + sample seed into Qdrant | Done |
| MongoDB session history | Done |
| Router eval (60 cases, phrase + groundedness) | Done |
| Hybrid retrieve + file list/delete | Done |
| Groundedness eval, citations, hop metrics | Done |
| Optional Azure OpenAI client | Done |
| CI (`tsc` + lint) | Done |
| Answer modes, file lock, provenance banner | Done |
| Accounts scope chats and uploads | Done |
| Auto peeks at this account’s files before web or model | Done |
| PDF ingest | Out of scope until this PRD changes |

---

When I add a feature I update this PRD, [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md), and [decision.md](decision.md).
