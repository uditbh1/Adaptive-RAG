import { z } from "zod";
import { TavilySearch } from "@langchain/tavily";
import { getChatModel } from "../llm";
import { matchSources, peekDocuments, retrieveDocuments } from "../rag/store";
import { timeHop, tokensFromMessage } from "./observe";
import { buildProvenance } from "./provenance";
import type { AnswerMode, GraphStateType, RetrievedDoc, Route } from "./state";

const gradeSchema = z.object({
  relevant: z
    .boolean()
    .describe("True only if at least one chunk can answer the question"),
  reason: z.string().describe("One short sentence"),
});

const rewriteSchema = z.object({
  query: z.string().describe("A clearer search query for the same user question"),
});

const fallbackRouteSchema = z.object({
  route: z
    .enum(["search", "general"])
    .describe(
      "search = live web facts; general = greetings, math, or common knowledge. The files were already checked.",
    ),
  reason: z.string().describe("One short sentence explaining the choice"),
});

function formatDocs(docs: RetrievedDoc[]) {
  if (docs.length === 0) {
    return "(no documents)";
  }
  return docs
    .map((doc, i) => {
      const source = String(doc.metadata.source ?? "unknown");
      return `[${i + 1}] (${source})\n${doc.pageContent}`;
    })
    .join("\n\n");
}

function needsLiveWeb(question: string) {
  return /\b(weather|temperature|forecast|who won|who is the current|headline|news|price|stock|today|tonight|this week|latest)\b/i.test(
    question,
  );
}

function keepIndexedDocs(docs: RetrievedDoc[]) {
  return docs.filter((doc) => {
    const origin = String(doc.metadata.origin ?? "");
    const source = String(doc.metadata.source ?? "");
    return origin === "upload" || origin === "sample" || source.toLowerCase().endsWith(".txt");
  });
}

function formatHistoryBlock(history: string) {
  if (!history.trim()) {
    return "No prior conversation.";
  }
  return history;
}

async function gradeChunks(question: string, documents: RetrievedDoc[]) {
  if (documents.length === 0) {
    return { relevant: false, metrics: [{ name: "grade", ms: 0 }] };
  }
  const namedHit =
    matchSources(
      question,
      documents.map((doc) => String(doc.metadata.source ?? "")).filter(Boolean),
    ).length > 0;
  if (namedHit) {
    return { relevant: true, metrics: [{ name: "grade", ms: 0 }] };
  }
  const { result, metrics } = await timeHop("grade", async () => {
    const llm = getChatModel().withStructuredOutput(gradeSchema);
    return llm.invoke([
      {
        role: "system",
        content:
          "relevant=true when at least one chunk states the fact the question asks for, including a yes/no rule such as cannot or never. Chunks that only share the project name do not count. Missing live-web facts such as weather or news do not make a useful file chunk irrelevant. Greetings, thanks, and small talk are not document questions: relevant=false. If every chunk is off-topic or empty, relevant=false.",
      },
      {
        role: "user",
        content: `Question: ${question}\n\nChunks:\n${formatDocs(documents)}`,
      },
    ]);
  });
  return { relevant: result.relevant, metrics };
}

export async function routeNode(state: GraphStateType) {
  const mode: AnswerMode = state.answerMode || "auto";
  if (mode === "files") {
    const lock = state.lockedFile ? [`lock=${state.lockedFile}`] : [];
    return {
      route: "index" as Route,
      trace: ["route=index", "mode=files", ...lock],
      metrics: [{ name: "classify", ms: 0 }],
    };
  }
  if (mode === "web") {
    return {
      route: "search" as Route,
      trace: ["route=search", "mode=web"],
      metrics: [{ name: "classify", ms: 0 }],
    };
  }

  const asked = state.originalQuestion || state.question;
  const { result: peeked, metrics: peekMetrics } = await timeHop("peek", () =>
    peekDocuments(asked, state.userId || "", 4),
  );
  const graded = await gradeChunks(asked, peeked);
  if (graded.relevant) {
    return {
      route: "index" as Route,
      documents: peeked,
      relevant: true,
      trace: [`peek=${peeked.length}`, "grade=yes", "route=index"],
      metrics: [...peekMetrics, ...graded.metrics],
    };
  }

  if (needsLiveWeb(asked)) {
    return {
      route: "search" as Route,
      documents: [],
      relevant: false,
      trace: [`peek=${peeked.length}`, "grade=no", "route=search"],
      metrics: [...peekMetrics, ...graded.metrics],
    };
  }

  const { result, metrics } = await timeHop("classify", async () => {
    const llm = getChatModel().withStructuredOutput(fallbackRouteSchema);
    return llm.invoke([
      {
        role: "system",
        content: `You are the Adaptive Classification router. The user's files and the sample knowledge base were already searched, and those chunks are not useful for this question. Pick exactly one pipeline:
- search: the question needs real-time or current-world facts (news, scores, today's weather, prices, "who won", "who is the current" office-holder).
- general: greetings, small talk, simple math, or evergreen common knowledge that does not need files or the live web.

Do not choose the file index. Use the conversation history to resolve short follow-ups like "and the score?".`,
      },
      {
        role: "user",
        content: `Conversation so far:\n${formatHistoryBlock(state.history)}\n\nCurrent question:\n${state.question}`,
      },
    ]);
  });

  return {
    route: result.route as Route,
    documents: [],
    relevant: false,
    trace: [`peek=${peeked.length}`, "grade=no", `route=${result.route}`],
    metrics: [...peekMetrics, ...graded.metrics, ...metrics],
  };
}

export async function retrieveNode(state: GraphStateType) {
  const { result: documents, metrics } = await timeHop("retrieve", () =>
    retrieveDocuments(
      state.question,
      4,
      state.originalQuestion,
      state.lockedFile || undefined,
      state.userId || "",
    ),
  );
  return {
    documents,
    trace: [`retrieve=${documents.length}`],
    metrics,
  };
}

export async function gradeNode(state: GraphStateType) {
  const asked = state.originalQuestion || state.question;
  const graded = await gradeChunks(asked, state.documents);
  return {
    relevant: graded.relevant,
    trace: [`grade=${graded.relevant ? "yes" : "no"}`],
    metrics: graded.metrics,
  };
}

export async function rewriteNode(state: GraphStateType) {
  const { result, metrics } = await timeHop("rewrite", async () => {
    const llm = getChatModel().withStructuredOutput(rewriteSchema);
    return llm.invoke([
      {
        role: "system",
        content:
          "Rewrite the user question as a short retrieval query for uploaded documents. If the question also asks for live web facts, keep only the document or file part. Do not answer it.",
      },
      { role: "user", content: state.question },
    ]);
  });

  return {
    question: result.query,
    rewriteCount: state.rewriteCount + 1,
    trace: ["rewrite"],
    metrics,
  };
}

export async function webSearchNode(state: GraphStateType) {
  if ((state.answerMode || "auto") === "files") {
    return {
      documents: keepIndexedDocs(state.documents),
      trace: ["webSearch=blocked"],
      metrics: [{ name: "webSearch", ms: 0 }],
    };
  }

  const { result, metrics } = await timeHop("webSearch", async () => {
    if (!process.env.TAVILY_API_KEY) {
      const kept = keepIndexedDocs(state.documents);
      return {
        documents: [
          ...kept,
          {
            pageContent:
              "Web search is not configured. Set TAVILY_API_KEY in .env.local.",
            metadata: { source: "tavily", error: true },
          },
        ],
        trace: ["webSearch=skipped"] as string[],
      };
    }

    const tool = new TavilySearch({
      maxResults: 4,
      tavilyApiKey: process.env.TAVILY_API_KEY,
    });
    const raw = await tool.invoke({ query: state.question });
    const documents = normalizeTavily(raw);
    const kept = keepIndexedDocs(state.documents);
    return {
      documents: [...kept, ...documents],
      trace:
        kept.length > 0
          ? [`webSearch=${documents.length}`, `keptDocs=${kept.length}`]
          : [`webSearch=${documents.length}`],
    };
  });

  return { ...result, metrics };
}

export async function generalLlmNode(state: GraphStateType) {
  let tokens: number | undefined;
  const { result, metrics } = await timeHop(
    "general",
    async () => {
      const llm = getChatModel();
      const message = await llm.invoke([
        {
          role: "system",
          content:
            "Answer briefly and clearly. You are the general-knowledge path of Adaptive RAG. Do not pretend you searched documents or the web. Use conversation history only to resolve follow-ups.",
        },
        {
          role: "user",
          content: `Conversation so far:\n${formatHistoryBlock(state.history)}\n\nCurrent question:\n${state.originalQuestion || state.question}`,
        },
      ]);
      tokens = tokensFromMessage(message);
      return contentToText(message.content);
    },
    () => tokens,
  );

  return {
    answer: result,
    sources: [],
    trace: ["general"],
    metrics,
    provenance: buildProvenance({
      mode: state.answerMode || "auto",
      route: "general",
      relevant: false,
      documents: [],
    }),
  };
}

export function collectSources(docs: RetrievedDoc[]) {
  const sources: string[] = [];
  for (const doc of docs) {
    const source = String(doc.metadata.source ?? "").trim();
    if (source && source !== "unknown" && !sources.includes(source)) {
      sources.push(source);
    }
  }
  return sources;
}

function withSourceFooter(answer: string, sources: string[]) {
  if (sources.length === 0) return answer;
  if (/sources?:/i.test(answer)) return answer;
  return `${answer.trim()}\n\nSources: ${sources.join(", ")}`;
}

export async function generateNode(state: GraphStateType) {
  const asked = state.originalQuestion || state.question;
  const mode: AnswerMode = state.answerMode || "auto";
  const filesOnly = mode === "files";
  const webOnly = mode === "web";

  if (filesOnly && (!state.relevant || state.documents.length === 0)) {
    return {
      answer: "That is not in the indexed documents.",
      sources: [],
      trace: ["generate=not-in-docs"],
      metrics: [{ name: "generate", ms: 0 }],
      provenance: buildProvenance({
        mode,
        route: state.route || "index",
        relevant: false,
        documents: state.documents,
      }),
    };
  }

  const sources = collectSources(state.documents);
  const system = filesOnly
    ? "Answer using ONLY the file chunks. If they do not contain the answer, say it is not in the indexed documents. Do not use general knowledge or the web. When you can, quote a short line from the file. Keep the answer short."
    : webOnly
      ? "Answer using only the web snippets. Do not claim you read the user's files. Mention URLs when they appear. Keep the answer short."
      : "Answer using the provided context. Use file chunks for questions about uploaded documents and web snippets for live facts. You may combine both in one answer. If a named file is in the context, summarise it. Keep the file's own words for names, return values, and rules. Only say you do not know when that part is missing from the context. Cite source filenames or URLs. Keep the answer short.";

  let tokens: number | undefined;
  const { result, metrics } = await timeHop(
    "generate",
    async () => {
      const llm = getChatModel();
      const message = await llm.invoke([
        {
          role: "system",
          content: system,
        },
        {
          role: "user",
          content: `Conversation so far:\n${formatHistoryBlock(state.history)}\n\nQuestion: ${asked}\n\nContext:\n${formatDocs(state.documents)}`,
        },
      ]);
      tokens = tokensFromMessage(message);
      return withSourceFooter(contentToText(message.content), sources);
    },
    () => tokens,
  );

  return {
    answer: result,
    sources,
    trace: ["generate"],
    metrics,
    provenance: buildProvenance({
      mode,
      route: state.route || "index",
      relevant: state.relevant,
      documents: state.documents,
    }),
  };
}

export function afterRoute(state: GraphStateType) {
  const mode: AnswerMode = state.answerMode || "auto";
  const asked = state.originalQuestion || state.question;
  if (mode === "files") return "retrieve";
  if (mode === "web") return "webSearch";
  if (
    state.route === "index" &&
    state.relevant &&
    state.documents.length > 0
  ) {
    return needsLiveWeb(asked) ? "webSearch" : "generate";
  }
  if (state.route === "search") return "webSearch";
  if (state.route === "general") return "generalLlm";
  return "retrieve";
}

export function afterGrade(state: GraphStateType) {
  const mode: AnswerMode = state.answerMode || "auto";
  const asked = state.originalQuestion || state.question;
  if (state.relevant) {
    if (mode === "files") return "generate";
    if (needsLiveWeb(asked)) return "webSearch";
    return "generate";
  }
  if (state.rewriteCount < 1) return "rewrite";
  if (mode === "files") return "generate";
  return "webSearch";
}

function contentToText(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: string }).text);
        }
        return "";
      })
      .join("");
  }
  return String(content ?? "");
}

function normalizeTavily(raw: unknown): RetrievedDoc[] {
  if (typeof raw === "string") {
    try {
      return normalizeTavily(JSON.parse(raw));
    } catch {
      return [{ pageContent: raw, metadata: { source: "tavily" } }];
    }
  }

  if (raw && typeof raw === "object") {
    const obj = raw as {
      results?: Array<{ content?: string; url?: string; title?: string }>;
      answer?: string;
    };
    const fromResults = (obj.results ?? []).map((item) => ({
      pageContent: [item.title, item.content, item.url].filter(Boolean).join("\n"),
      metadata: { source: item.url ?? "tavily" },
    }));
    if (fromResults.length > 0) return fromResults;
    if (obj.answer) {
      return [{ pageContent: obj.answer, metadata: { source: "tavily" } }];
    }
  }

  return [{ pageContent: JSON.stringify(raw), metadata: { source: "tavily" } }];
}
