import { NextResponse } from "next/server";
import { createAuthSession, withAuthCookie } from "@/lib/auth/session";
import { login, normalizeEmail, normalizePassword } from "@/lib/auth/users";

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
      { error: "Email or password is incorrect." },
      { status: 401 },
    );
  }

  try {
    const user = await login(email, password);
    const token = await createAuthSession(user.id);
    return withAuthCookie(
      NextResponse.json({ id: user.id, email: user.email }),
      token,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not sign in.";
    const status = message.includes("incorrect") ? 401 : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
