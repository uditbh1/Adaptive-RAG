import { NextResponse } from "next/server";
import { listConversations } from "@/lib/memory/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sessions = await listConversations();
    return NextResponse.json({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load history.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
