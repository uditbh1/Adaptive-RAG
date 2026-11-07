import { NextResponse } from "next/server";
import { unauthorized, userFromRequest } from "@/lib/auth/session";
import { parseSessionId, SessionAccessError, getSession } from "@/lib/memory/sessions";
import { saveUpload } from "@/lib/rag/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return unauthorized();

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload a .txt file." }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".txt")) {
    return NextResponse.json(
      { error: "Only .txt files are supported." },
      { status: 400 },
    );
  }

  const text = await file.text();
  if (!text.trim()) {
    return NextResponse.json({ error: "The file is empty." }, { status: 400 });
  }

  const sessionId = parseSessionId(form.get("sessionId"));
  if (sessionId) {
    try {
      await getSession(sessionId, user.id);
    } catch (error) {
      if (error instanceof SessionAccessError) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      const message = error instanceof Error ? error.message : "Upload failed.";
      return NextResponse.json({ error: message }, { status: 503 });
    }
  }

  try {
    const result = await saveUpload(file.name, text, user.id, sessionId);
    return NextResponse.json({
      ok: true,
      filename: result.filename,
      chunks: result.chunks,
      reused: result.reused,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
