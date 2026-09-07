# Evaluation

## What we measure

Router accuracy: for each case in [`eval/cases.json`](../eval/cases.json), does `runAdaptiveRag` set `route` to `expectedRoute`?

We do **not** score the wording of the final answer in v1.

## How to run

```bash
# needs OPENAI_API_KEY and QDRANT_URL in .env.local
# docker compose up -d qdrant
npm run eval
```

The script:

1. Loads env from `.env.local`
2. Seeds / loads the vector store (sample file if empty)
3. Runs all 10 cases
4. Prints `id`, expected, actual, PASS/FAIL, and the trace
5. Exits with code 1 if any case fails

## Case mix

| Route | Count | Example |
| --- | --- | --- |
| `index` | 5 | Rewrite budget, Azure AI Search hybrid, Document Intelligence |
| `search` | 3 | Latest Champions League winner, London weather today |
| `general` | 2 | Greeting, `2 + 2` |

Index cases are written against facts in [`data/sample/azure-ai.txt`](../data/sample/azure-ai.txt). If you change that file, update the cases.

## How to read a trace

Example:

```
route=index -> retrieve=4 -> grade=yes -> generate
```

A miss that used the budget:

```
route=index -> retrieve=4 -> grade=no -> rewrite -> retrieve=4 -> grade=yes -> generate
```

Fallback after the budget is spent:

```
route=index -> retrieve=4 -> grade=no -> rewrite -> retrieve=3 -> grade=no -> webSearch=4 -> generate
```

## Interview use

Report **router accuracy** (for example 9/10) and one failure you understand. Do not claim the graph is “better” without this table. If the graph is more expensive than a single LLM call, say so: you pay more to retrieve less garbage.
