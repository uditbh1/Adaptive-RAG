import { config } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  missingRequiredPhrases,
  scoreGroundedness,
} from "../src/lib/eval/groundedness";
import { runAdaptiveRag } from "../src/lib/graph";
import { hasLlmCredentials } from "../src/lib/llm";
import { getVectorStore, seedSampleDocuments } from "../src/lib/rag/store";

config({ path: path.join(process.cwd(), ".env.local") });
config();

type EvalCase = {
  id: string;
  question: string;
  expectedRoute: "index" | "search" | "general";
  mustContain?: string[];
};

type CaseResult = {
  id: string;
  expectedRoute: string;
  actualRoute: string;
  routePass: boolean;
  phrasePass: boolean;
  missingPhrases: string[];
  groundedSupported: number;
  groundedTotal: number;
  trace: string[];
  ms: number;
};

function writeReport(results: CaseResult[]) {
  const routePass = results.filter((item) => item.routePass).length;
  const phraseCases = results.filter((item) => item.expectedRoute === "index");
  const phrasePass = phraseCases.filter((item) => item.phrasePass).length;
  const groundedSupported = results.reduce(
    (sum, item) => sum + item.groundedSupported,
    0,
  );
  const groundedTotal = results.reduce((sum, item) => sum + item.groundedTotal, 0);
  const byRoute = {
    index: results.filter((item) => item.expectedRoute === "index").length,
    search: results.filter((item) => item.expectedRoute === "search").length,
    general: results.filter((item) => item.expectedRoute === "general").length,
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    totals: {
      cases: results.length,
      routerAccuracy: `${routePass}/${results.length}`,
      phraseChecks: `${phrasePass}/${phraseCases.length}`,
      groundedness: `${groundedSupported}/${groundedTotal}`,
      byRoute,
    },
    results,
  };

  writeFileSync(
    path.join(process.cwd(), "eval", "latest.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );

  const failRows = results
    .filter((item) => !item.routePass || !item.phrasePass)
    .map(
      (item) =>
        `| ${item.id} | ${item.expectedRoute} | ${item.actualRoute} | ${item.missingPhrases.join(", ") || "—"} |`,
    )
    .join("\n");

  const markdown = `# Eval results

Generated: ${payload.generatedAt}

## Scores

| Metric | Value |
| --- | --- |
| Cases | ${results.length} |
| Router accuracy | ${routePass}/${results.length} |
| Phrase checks (index mustContain) | ${phrasePass}/${phraseCases.length} |
| Groundedness (supported claims) | ${groundedSupported}/${groundedTotal} |

## Case mix

| Route | Count |
| --- | --- |
| index | ${byRoute.index} |
| search | ${byRoute.search} |
| general | ${byRoute.general} |

\`\`\`mermaid
pie showData
  title Eval case mix
  "index" : ${byRoute.index}
  "search" : ${byRoute.search}
  "general" : ${byRoute.general}
\`\`\`

## Failures

${failRows || "_None._"}

Run \`npm run eval\` to refresh this file.
`;

  writeFileSync(
    path.join(process.cwd(), "eval", "RESULTS.md"),
    markdown,
    "utf8",
  );

  return payload.totals;
}

async function main() {
  if (!hasLlmCredentials()) {
    console.error("Set OPENAI_API_KEY or Azure OpenAI variables before running eval.");
    process.exit(1);
  }

  await getVectorStore();
  await seedSampleDocuments();

  const cases = JSON.parse(
    readFileSync(path.join(process.cwd(), "eval", "cases.json"), "utf8"),
  ) as EvalCase[];

  const results: CaseResult[] = [];
  console.log(
    "id".padEnd(32),
    "exp".padEnd(8),
    "got".padEnd(8),
    "route",
    "phrase",
    "ground",
    "  path",
  );
  console.log("-".repeat(110));

  for (const testCase of cases) {
    const result = await runAdaptiveRag(testCase.question);
    const routePass = result.route === testCase.expectedRoute;
    const phrases = testCase.mustContain ?? [];
    const missing = missingRequiredPhrases(result.answer, phrases);
    const phrasePass = missing.length === 0;
    const grounded =
      testCase.expectedRoute === "index" && result.route === "index"
        ? scoreGroundedness(
            result.answer,
            result.documents.map((doc) => doc.pageContent),
          )
        : { supported: 0, total: 0 };

    const row: CaseResult = {
      id: testCase.id,
      expectedRoute: testCase.expectedRoute,
      actualRoute: String(result.route),
      routePass,
      phrasePass,
      missingPhrases: missing,
      groundedSupported: grounded.supported,
      groundedTotal: grounded.total,
      trace: result.trace,
      ms: result.metrics.reduce((sum, hop) => sum + hop.ms, 0),
    };
    results.push(row);

    const ok = routePass && phrasePass;
    console.log(
      testCase.id.padEnd(32),
      testCase.expectedRoute.padEnd(8),
      String(result.route).padEnd(8),
      routePass ? "PASS" : "FAIL",
      phrasePass ? "PASS" : "FAIL",
      `${grounded.supported}/${grounded.total}`.padEnd(7),
      `  ${result.trace.join(" -> ")}  (${row.ms}ms)`,
    );
    if (!ok && missing.length > 0) {
      console.log(`    missing phrases: ${missing.join(", ")}`);
    }
  }

  const totals = writeReport(results);
  console.log("-".repeat(110));
  console.log(`Router accuracy: ${totals.routerAccuracy}`);
  console.log(`Phrase checks:   ${totals.phraseChecks}`);
  console.log(`Groundedness:    ${totals.groundedness}`);

  const failed = results.some((item) => !item.routePass || !item.phrasePass);
  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
