import { NextResponse } from "next/server";
import { unauthorized, userFromRequest } from "@/lib/auth/session";
import { listConversations } from "@/lib/memory/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return unauthorized();
  try {
    const sessions = await listConversations(user.id);
    return NextResponse.json({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load history.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
