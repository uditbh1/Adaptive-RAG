# Evaluation

## What we measure

1. **Router accuracy.** For each of the 60 cases in [`eval/cases.json`](../eval/cases.json), does `runAdaptiveRag` set `route` to `expectedRoute`? Eval calls `runAdaptiveRag(question)` with no `mode`, so it always uses Auto.
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

Auto, files were useful:

```
peek=4 -> grade=yes -> route=index -> generate
```

Auto, files were useful and the question also needs a live fact:

```
peek=4 -> grade=yes -> route=index -> webSearch=4 -> generate
```

Auto, files were not useful:

```
peek=4 -> grade=no -> route=search -> webSearch=4 -> generate
peek=4 -> grade=no -> route=general -> general
```

My files can still rewrite once. Eval does not use that mode:

```
route=index -> retrieve=4 -> grade=no -> rewrite -> retrieve=4 -> grade=yes -> generate
```

## How I use the scores

I report three numbers from [eval/RESULTS.md](../eval/RESULTS.md). Last local run: router **60/60**, phrases **38/38**, groundedness **76/84**. Eval passes with no user id, so the peek sees sample files only. If a case fails, I read the path before changing the router.
