import { config } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runAdaptiveRag } from "../src/lib/graph";
import { getVectorStore } from "../src/lib/rag/store";

config({ path: path.join(process.cwd(), ".env.local") });
config();

type EvalCase = {
  id: string;
  question: string;
  expectedRoute: "index" | "search" | "general";
};

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Set OPENAI_API_KEY in .env.local before running eval.");
    process.exit(1);
  }

  await getVectorStore();

  const cases = JSON.parse(
    readFileSync(path.join(process.cwd(), "eval", "cases.json"), "utf8"),
  ) as EvalCase[];

  let passed = 0;
  console.log("id".padEnd(28), "expected".padEnd(10), "actual".padEnd(10), "result", "  path");
  console.log("-".repeat(90));

  for (const testCase of cases) {
    const result = await runAdaptiveRag(testCase.question);
    const ok = result.route === testCase.expectedRoute;
    if (ok) passed += 1;
    console.log(
      testCase.id.padEnd(28),
      testCase.expectedRoute.padEnd(10),
      String(result.route).padEnd(10),
      ok ? "PASS" : "FAIL",
      `  ${result.trace.join(" -> ")}`,
    );
  }

  console.log("-".repeat(90));
  console.log(`Router accuracy: ${passed}/${cases.length}`);
  if (passed < cases.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
