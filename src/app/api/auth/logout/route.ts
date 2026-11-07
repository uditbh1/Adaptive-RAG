import { NextResponse } from "next/server";
import { destroyAuthSession, withoutAuthCookie } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await destroyAuthSession(request);
  } catch {
    // still clear the cookie
  }
  return withoutAuthCookie(NextResponse.json({ ok: true }));
}
