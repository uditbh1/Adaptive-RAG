import { END, START, StateGraph } from "@langchain/langgraph";
import {
  afterGrade,
  afterRoute,
  generalLlmNode,
  generateNode,
  gradeNode,
  retrieveNode,
  rewriteNode,
  routeNode,
  webSearchNode,
} from "./nodes";
import { GraphState, type AnswerMode, type HopMetric, type Provenance, type RetrievedDoc, type Route } from "./state";

const workflow = new StateGraph(GraphState)
  .addNode("classify", routeNode)
  .addNode("retrieve", retrieveNode)
  .addNode("grade", gradeNode)
  .addNode("rewrite", rewriteNode)
  .addNode("webSearch", webSearchNode)
  .addNode("generalLlm", generalLlmNode)
  .addNode("generate", generateNode)
  .addEdge(START, "classify")
  .addConditionalEdges("classify", afterRoute, {
    retrieve: "retrieve",
    webSearch: "webSearch",
    generalLlm: "generalLlm",
  })
  .addEdge("retrieve", "grade")
  .addConditionalEdges("grade", afterGrade, {
    generate: "generate",
    rewrite: "rewrite",
    webSearch: "webSearch",
  })
  .addEdge("rewrite", "retrieve")
  .addEdge("webSearch", "generate")
  .addEdge("generalLlm", END)
  .addEdge("generate", END);

export const adaptiveRagGraph = workflow.compile();

export type AdaptiveRagResult = {
  answer: string;
  route: Route | "";
  trace: string[];
  rewriteCount: number;
  sources: string[];
  documents: RetrievedDoc[];
  metrics: HopMetric[];
  provenance: Provenance;
  answerMode: AnswerMode;
  lockedFile: string;
};

export async function runAdaptiveRag(
  question: string,
  history = "",
  options?: { mode?: AnswerMode; lockedFile?: string },
): Promise<AdaptiveRagResult> {
  const answerMode = options?.mode ?? "auto";
  const lockedFile = options?.lockedFile?.trim() ?? "";
  const state = await adaptiveRagGraph.invoke({
    question,
    originalQuestion: question,
    history,
    route: "",
    documents: [],
    rewriteCount: 0,
    relevant: false,
    answer: "",
    trace: [],
    sources: [],
    metrics: [],
    answerMode,
    lockedFile,
  });

  return {
    answer: state.answer,
    route: state.route,
    trace: state.trace,
    rewriteCount: state.rewriteCount,
    sources: state.sources,
    documents: state.documents,
    metrics: state.metrics,
    provenance: state.provenance,
    answerMode: state.answerMode,
    lockedFile: state.lockedFile,
  };
}
