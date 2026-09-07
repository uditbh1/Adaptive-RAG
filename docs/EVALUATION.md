# Evaluation

## What we measure

1. **Router accuracy.** For each case in [`eval/cases.json`](../eval/cases.json), does `runAdaptiveRag` set `route` to `expectedRoute`?
2. **Groundedness on index answers.** After an index run, each claim in the answer is checked against the retrieved chunks. A claim counts as supported if enough of its content words appear in those chunks.

We do not score writing style.

## How to run

```bash
# needs OPENAI_API_KEY or Azure OpenAI vars, plus QDRANT_URL
# docker compose up -d qdrant
npm run eval
```

The script:

1. Loads env from `.env.local`, then `.env`
2. Loads the vector store (seeds the sample file if the collection is empty)
3. Runs all 10 cases
4. Prints `id`, expected, actual, PASS/FAIL, the path, and elapsed ms
5. Prints router accuracy and groundedness totals
6. Exits with code 1 if any route check fails

## Case mix

| Route | Count | Example |
| --- | --- | --- |
| `index` | 5 | Rewrite budget, Azure AI Search hybrid, Document Intelligence |
| `search` | 3 | Latest Champions League winner, London weather today |
| `general` | 2 | Greeting, `2 + 2` |

Index cases use facts in [`data/sample/azure-ai.txt`](../data/sample/azure-ai.txt). If that file changes, update the cases.

## How to read a trace

```
route=index -> retrieve=4 -> grade=yes -> generate
```

A miss that used the rewrite budget:

```
route=index -> retrieve=4 -> grade=no -> rewrite -> retrieve=4 -> grade=yes -> generate
```

Fallback after the budget is spent:

```
route=index -> retrieve=4 -> grade=no -> rewrite -> retrieve=3 -> grade=no -> webSearch=4 -> generate
```

## How I use the scores

I report router accuracy (for example 9/10) and groundedness (supported claims / total claims on index cases). If a case fails, I read the path before changing the router prompt.
