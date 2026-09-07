import { NextResponse } from "next/server";
import { saveUpload } from "@/lib/rag/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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

  try {
    const result = await saveUpload(file.name, text);
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
