import { z } from "zod";
import { TavilySearch } from "@langchain/tavily";
import { getChatModel } from "../llm";
import { matchSources, retrieveDocuments } from "../rag/store";
import type { GraphStateType, RetrievedDoc, Route } from "./state";

const routeSchema = z.object({
  route: z
    .enum(["index", "search", "general"])
    .describe(
      "index = uploaded / knowledge-base documents; search = live web facts; general = greetings, math, or common knowledge",
    ),
  reason: z.string().describe("One short sentence explaining the choice"),
});

const gradeSchema = z.object({
  relevant: z
    .boolean()
    .describe("True only if at least one chunk can answer the question"),
  reason: z.string().describe("One short sentence"),
});

const rewriteSchema = z.object({
  query: z.string().describe("A clearer search query for the same user question"),
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
  return /\b(weather|temperature|forecast|who won|headline|news|price|stock|today|tonight|this week|latest)\b/i.test(
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

export async function routeNode(state: GraphStateType) {
  const llm = getChatModel().withStructuredOutput(routeSchema);
  const result = await llm.invoke([
    {
      role: "system",
      content: `You are the Adaptive Classification router. Pick exactly one processing pipeline:
- index: the question can be answered from uploaded documents or the project knowledge base (Adaptive RAG, rewrite budget, Azure AI Search, Azure OpenAI, Document Intelligence, Content Safety, groundedness, LangGraph.js). Also use index for follow-ups that still refer to those documents.
- search: the question needs real-time web facts (news, scores, today's weather, prices, "who won last...").
- general: greetings, small talk, simple math, or evergreen common knowledge that does not need files or the live web.

Use the conversation history to resolve short follow-ups like "what about hybrid search?" or "and the score?".`,
    },
    {
      role: "user",
      content: `Conversation so far:\n${formatHistoryBlock(state.history)}\n\nCurrent question:\n${state.question}`,
    },
  ]);

  return {
    route: result.route as Route,
    trace: [`route=${result.route}`],
  };
}

export async function retrieveNode(state: GraphStateType) {
  const documents = await retrieveDocuments(
    state.question,
    4,
    state.originalQuestion,
  );
  return {
    documents,
    trace: [`retrieve=${documents.length}`],
  };
}

export async function gradeNode(state: GraphStateType) {
  const asked = state.originalQuestion || state.question;
  const namedHit =
    matchSources(
      asked,
      state.documents
        .map((doc) => String(doc.metadata.source ?? ""))
        .filter(Boolean),
    ).length > 0;

  if (namedHit) {
    return {
      relevant: true,
      trace: ["grade=yes"],
    };
  }

  const llm = getChatModel().withStructuredOutput(gradeSchema);
  const result = await llm.invoke([
    {
      role: "system",
      content:
        "Decide if the retrieved chunks are useful for any document-related part of the user question. Missing live-web facts such as weather or news do not make file chunks irrelevant. If the chunks are off-topic or empty, relevant=false.",
    },
    {
      role: "user",
      content: `Question: ${asked}\n\nChunks:\n${formatDocs(state.documents)}`,
    },
  ]);

  return {
    relevant: result.relevant,
    trace: [`grade=${result.relevant ? "yes" : "no"}`],
  };
}

export async function rewriteNode(state: GraphStateType) {
  const llm = getChatModel().withStructuredOutput(rewriteSchema);
  const result = await llm.invoke([
    {
      role: "system",
      content:
        "Rewrite the user question as a short retrieval query for uploaded documents. If the question also asks for live web facts, keep only the document or file part. Do not answer it.",
    },
    { role: "user", content: state.question },
  ]);

  return {
    question: result.query,
    rewriteCount: state.rewriteCount + 1,
    trace: ["rewrite"],
  };
}

export async function webSearchNode(state: GraphStateType) {
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
      trace: ["webSearch=skipped"],
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
}

export async function generalLlmNode(state: GraphStateType) {
  const llm = getChatModel();
  const result = await llm.invoke([
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

  return {
    answer: contentToText(result.content),
    trace: ["general"],
  };
}

export async function generateNode(state: GraphStateType) {
  const llm = getChatModel();
  const asked = state.originalQuestion || state.question;
  const result = await llm.invoke([
    {
      role: "system",
      content:
        "Answer using the provided context. Use file chunks for questions about uploaded documents and web snippets for live facts. You may combine both in one answer. If a named file is in the context, summarise it. Only say you do not know when that part is missing from the context. Mention sources when they appear. Keep the answer short.",
    },
    {
      role: "user",
      content: `Conversation so far:\n${formatHistoryBlock(state.history)}\n\nQuestion: ${asked}\n\nContext:\n${formatDocs(state.documents)}`,
    },
  ]);

  return {
    answer: contentToText(result.content),
    trace: ["generate"],
  };
}

export function afterRoute(state: GraphStateType) {
  if (state.route === "search") return "webSearch";
  if (state.route === "general") return "generalLlm";
  return "retrieve";
}

export function afterGrade(state: GraphStateType) {
  const asked = state.originalQuestion || state.question;
  if (state.relevant && needsLiveWeb(asked)) return "webSearch";
  if (state.relevant) return "generate";
  if (state.rewriteCount < 1) return "rewrite";
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
