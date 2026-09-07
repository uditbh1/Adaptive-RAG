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
import { GraphState, type HopMetric, type RetrievedDoc, type Route } from "./state";

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
};

export async function runAdaptiveRag(
  question: string,
  history = "",
): Promise<AdaptiveRagResult> {
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
  });

  return {
    answer: state.answer,
    route: state.route,
    trace: state.trace,
    rewriteCount: state.rewriteCount,
    sources: state.sources,
    documents: state.documents,
    metrics: state.metrics,
  };
}
