import { NextResponse } from "next/server";
import { unauthorized, userFromRequest } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await userFromRequest(request);
    if (!user) return unauthorized();
    return NextResponse.json(user);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the account.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
