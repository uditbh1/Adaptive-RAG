import { NextResponse } from "next/server";
import { listConversations, parseSessionIds } from "@/lib/memory/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sessionIds?: unknown };
    const sessionIds = parseSessionIds(body?.sessionIds);
    const sessions = await listConversations(sessionIds);
    return NextResponse.json({ sessions });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Expected JSON with sessionIds." }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Could not load history.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
