# Adaptive RAG (TypeScript)

A Next.js Adaptive RAG app. A LangGraph.js graph **changes path** for each question: indexed documents, live web search, or the model alone. Weak document hits get **one rewrite**, then web search. The UI shows that path.

This follows the Adaptive RAG idea from [dhruvsinghal09/Adaptive-Rag](https://github.com/dhruvsinghal09/Adaptive-Rag). It is not a full clone. Product spec: [prd.md](prd.md).

## How it works

```
question
   -> route (index | search | general)
        index  -> retrieve -> grade
                    grade yes -> generate
                    grade no + rewrite left -> rewrite -> retrieve
                    grade no + no rewrite left -> web search -> generate
        search -> web search -> generate
        general -> LLM answer
```

Rewrite budget: **exactly one**. That stops an infinite retrieve loop.

## Setup

1. Copy `.env.example` to `.env.local` and add `OPENAI_API_KEY` (and `TAVILY_API_KEY` for web search).
2. Start MongoDB and Qdrant:

```bash
docker compose up -d
```

3. Install and run:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The sample file `data/sample/azure-ai.txt` is indexed on the first question.

Try:

- Index: `What rewrite budget does the Adaptive RAG demo use?`
- Search: `Who won the most recent UEFA Champions League final?`
- General: `What is 2 + 2?`

## Eval

Ten fixed questions check that the router picked the expected path.

```bash
npm run eval
```

See [docs/EVALUATION.md](docs/EVALUATION.md).

## Documentation

| File | What it covers |
| --- | --- |
| [prd.md](prd.md) | Product requirements (goals, journeys, metrics) |
| [tech-stack.md](tech-stack.md) | Libraries, env, what we did not use |
| [decision.md](decision.md) | Living log of decisions (append as you build) |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Engineering FR / NFR IDs |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Graph, APIs, data flow |
| [docs/EVALUATION.md](docs/EVALUATION.md) | How we measure the router |
| [AGENTS.md](AGENTS.md) | Short notes for coding agents |
