import { Annotation } from "@langchain/langgraph";

export type Route = "index" | "search" | "general";

export type RetrievedDoc = {
  pageContent: string;
  metadata: Record<string, unknown>;
};

export const GraphState = Annotation.Root({
  question: Annotation<string>(),
  originalQuestion: Annotation<string>(),
  history: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  route: Annotation<Route | "">(),
  documents: Annotation<RetrievedDoc[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  rewriteCount: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  relevant: Annotation<boolean>({
    reducer: (_current, update) => update,
    default: () => false,
  }),
  answer: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  trace: Annotation<string[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
});

export type GraphStateType = typeof GraphState.State;
