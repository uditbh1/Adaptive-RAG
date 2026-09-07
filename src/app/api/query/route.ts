import { NextResponse } from "next/server";
import { runAdaptiveRag } from "@/lib/graph";
import { hasLlmCredentials } from "@/lib/llm";
import { appendTurn, formatHistory, getSession } from "@/lib/memory/sessions";
import { getChunkCount, getVectorStore } from "@/lib/rag/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serviceError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  return NextResponse.json({ error: message }, { status: 503 });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    query?: string;
    sessionId?: string;
  };

  const query = body.query?.trim();
  const sessionId = body.sessionId?.trim() || "demo";

  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  if (!hasLlmCredentials()) {
    return NextResponse.json(
      {
        error:
          "Set OPENAI_API_KEY or Azure OpenAI variables in .env.local (see .env.example).",
      },
      { status: 500 },
    );
  }

  try {
    await getVectorStore();
    const history = await formatHistory(sessionId);
    await appendTurn(sessionId, { role: "user", content: query });

    const result = await runAdaptiveRag(query, history);
    const turns = await appendTurn(sessionId, {
      role: "assistant",
      content: result.answer,
      route: result.route,
      trace: result.trace,
      sources: result.sources,
      metrics: result.metrics,
    });

    return NextResponse.json({
      answer: result.answer,
      route: result.route,
      trace: result.trace,
      sources: result.sources,
      metrics: result.metrics,
      rewriteCount: result.rewriteCount,
      chunksIndexed: await getChunkCount(),
      history: turns,
    });
  } catch (error) {
    return serviceError(error);
  }
}

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId") || "demo";
  try {
    return NextResponse.json({
      history: await getSession(sessionId),
      chunksIndexed: await getChunkCount(),
    });
  } catch (error) {
    return serviceError(error);
  }
}
