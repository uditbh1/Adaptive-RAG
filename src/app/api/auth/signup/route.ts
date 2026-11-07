import { NextResponse } from "next/server";
import { createAuthSession, withAuthCookie } from "@/lib/auth/session";
import { normalizeEmail, normalizePassword, signup } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    password?: unknown;
  } | null;
  const email = normalizeEmail(body?.email);
  const password = normalizePassword(body?.password);
  if (!email || !password) {
    return NextResponse.json(
      { error: "Use a valid email and a password of at least 8 characters." },
      { status: 400 },
    );
  }

  try {
    const user = await signup(email, password);
    const token = await createAuthSession(user.id);
    return withAuthCookie(
      NextResponse.json({ id: user.id, email: user.email }),
      token,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the account.";
    const status = message.includes("already exists") ? 409 : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
