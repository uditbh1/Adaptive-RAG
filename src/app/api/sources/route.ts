import { NextResponse } from "next/server";
import {
  deleteIndexedFile,
  getVectorStore,
  listIndexedFiles,
} from "@/lib/rag/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getVectorStore();
    return NextResponse.json({ files: await listIndexedFiles() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list files.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const body = (await request.json()) as { filename?: string };
  const filename = body.filename?.trim();
  if (!filename) {
    return NextResponse.json({ error: "filename is required." }, { status: 400 });
  }

  try {
    const files = await listIndexedFiles();
    const target = files.find(
      (file) => file.filename.toLowerCase() === filename.toLowerCase(),
    );
    if (!target) {
      return NextResponse.json({ error: "File is not in the index." }, { status: 404 });
    }
    if (!target.canDelete) {
      return NextResponse.json(
        { error: "The sample knowledge base cannot be deleted." },
        { status: 400 },
      );
    }
    const result = await deleteIndexedFile(filename);
    return NextResponse.json({
      ok: true,
      filename: result.filename,
      files: await listIndexedFiles(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
