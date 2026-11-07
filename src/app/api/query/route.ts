import { NextResponse } from "next/server";
import { unauthorized, userFromRequest } from "@/lib/auth/session";
import { runAdaptiveRag } from "@/lib/graph";
import type { AnswerMode } from "@/lib/graph/state";
import { hasLlmCredentials } from "@/lib/llm";
import {
  appendTurn,
  formatHistory,
  getSession,
  parseSessionId,
  SessionAccessError,
} from "@/lib/memory/sessions";
import { countVisibleChunks, getVectorStore } from "@/lib/rag/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serviceError(error: unknown) {
  if (error instanceof SessionAccessError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  const message = error instanceof Error ? error.message : "Unexpected server error";
  return NextResponse.json({ error: message }, { status: 503 });
}

export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return unauthorized();

  const body = (await request.json()) as {
    query?: string;
    sessionId?: string;
    mode?: AnswerMode;
    lockedFile?: string;
  };

  const query = body.query?.trim();
  const sessionId = parseSessionId(body.sessionId);
  const mode: AnswerMode =
    body.mode === "files" || body.mode === "web" ? body.mode : "auto";
  const lockedFile = mode === "files" ? body.lockedFile?.trim() || "" : "";

  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
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
    const history = await formatHistory(sessionId, user.id);
    await appendTurn(sessionId, user.id, { role: "user", content: query });

    const result = await runAdaptiveRag(query, history, {
      mode,
      lockedFile,
      userId: user.id,
      sessionId,
    });
    const turns = await appendTurn(sessionId, user.id, {
      role: "assistant",
      content: result.answer,
      route: result.route,
      trace: result.trace,
      sources: result.sources,
      metrics: result.metrics,
      provenance: result.provenance,
    });

    return NextResponse.json({
      answer: result.answer,
      route: result.route,
      trace: result.trace,
      sources: result.sources,
      metrics: result.metrics,
      provenance: result.provenance,
      rewriteCount: result.rewriteCount,
      chunksIndexed: await countVisibleChunks(user.id),
      history: turns,
    });
  } catch (error) {
    return serviceError(error);
  }
}

export async function GET(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return unauthorized();
  const sessionId = parseSessionId(new URL(request.url).searchParams.get("sessionId"));
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }
  try {
    return NextResponse.json({
      history: await getSession(sessionId, user.id),
      chunksIndexed: await countVisibleChunks(user.id),
    });
  } catch (error) {
    return serviceError(error);
  }
}
