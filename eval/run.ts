import { config } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { scoreGroundedness } from "../src/lib/eval/groundedness";
import { runAdaptiveRag } from "../src/lib/graph";
import { hasLlmCredentials } from "../src/lib/llm";
import { getVectorStore } from "../src/lib/rag/store";

config({ path: path.join(process.cwd(), ".env.local") });
config();

type EvalCase = {
  id: string;
  question: string;
  expectedRoute: "index" | "search" | "general";
};

async function main() {
  if (!hasLlmCredentials()) {
    console.error("Set OPENAI_API_KEY or Azure OpenAI variables before running eval.");
    process.exit(1);
  }

  await getVectorStore();

  const cases = JSON.parse(
    readFileSync(path.join(process.cwd(), "eval", "cases.json"), "utf8"),
  ) as EvalCase[];

  let passed = 0;
  let groundedSupported = 0;
  let groundedTotal = 0;
  let indexCases = 0;

  console.log(
    "id".padEnd(28),
    "expected".padEnd(10),
    "actual".padEnd(10),
    "result",
    "  path",
  );
  console.log("-".repeat(100));

  for (const testCase of cases) {
    const result = await runAdaptiveRag(testCase.question);
    const ok = result.route === testCase.expectedRoute;
    if (ok) passed += 1;

    if (testCase.expectedRoute === "index" && result.route === "index") {
      indexCases += 1;
      const score = scoreGroundedness(
        result.answer,
        result.documents.map((doc) => doc.pageContent),
      );
      groundedSupported += score.supported;
      groundedTotal += score.total;
    }

    const totalMs = result.metrics.reduce((sum, hop) => sum + hop.ms, 0);
    console.log(
      testCase.id.padEnd(28),
      testCase.expectedRoute.padEnd(10),
      String(result.route).padEnd(10),
      ok ? "PASS" : "FAIL",
      `  ${result.trace.join(" -> ")}  (${totalMs}ms)`,
    );
  }

  console.log("-".repeat(100));
  console.log(`Router accuracy: ${passed}/${cases.length}`);
  if (groundedTotal > 0) {
    console.log(
      `Groundedness (index claims): ${groundedSupported}/${groundedTotal} across ${indexCases} index cases`,
    );
  }
  if (passed < cases.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
