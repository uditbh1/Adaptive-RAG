import { Annotation } from "@langchain/langgraph";
import type { HopMetric } from "./observe";

export type Route = "index" | "search" | "general";
export type AnswerMode = "auto" | "files" | "web";
export type { HopMetric };

export type RetrievedDoc = {
  pageContent: string;
  metadata: Record<string, unknown>;
};

export type Quote = {
  source: string;
  text: string;
};

export type Provenance = {
  kind: "files" | "web" | "mixed" | "model";
  label: string;
  fileSources: string[];
  webSources: string[];
  quote?: Quote;
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
  sources: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  metrics: Annotation<HopMetric[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
  answerMode: Annotation<AnswerMode>({
    reducer: (_current, update) => update,
    default: () => "auto",
  }),
  lockedFile: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  provenance: Annotation<Provenance>({
    reducer: (_current, update) => update,
    default: () => ({
      kind: "model",
      label: "Not from your files · model only",
      fileSources: [],
      webSources: [],
    }),
  }),
});

export type GraphStateType = typeof GraphState.State;
