# Evaluation

## What we measure

1. **Router accuracy.** For each of the 60 cases in [`eval/cases.json`](../eval/cases.json), does `runAdaptiveRag` set `route` to `expectedRoute`?
2. **Phrase checks.** Index cases list `mustContain` strings that must appear in the answer (from the sample files).
3. **Groundedness.** After an index run, each claim in the answer is checked against the retrieved chunks. A claim counts as supported if enough of its content words appear in those chunks.

We do not score writing style.

## How to run

```bash
# needs OPENAI_API_KEY or Azure OpenAI vars, plus QDRANT_URL
# docker compose up -d qdrant
npm run eval
```

The script:

1. Loads env from `.env.local`, then `.env`
2. Loads Qdrant and seeds any missing file from `data/sample/`
3. Runs all 60 cases
4. Prints route, phrase, groundedness, path, and ms
5. Writes [`eval/RESULTS.md`](../eval/RESULTS.md) and [`eval/latest.json`](../eval/latest.json)
6. Exits with code 1 if a route or phrase check fails

## Case mix

| Route | Count | Extra checks |
| --- | --- | --- |
| `index` | 38 | `mustContain` + groundedness |
| `search` | 12 | route only |
| `general` | 10 | route only |

Index cases use facts in [`data/sample/`](../data/sample/). If those files change, update `mustContain` in `eval/cases.json`.

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

I report three numbers from [eval/RESULTS.md](../eval/RESULTS.md). Last local run: router **60/60**, phrases **38/38**, groundedness **87/97**. If a case fails, I read the path before changing the router prompt.
