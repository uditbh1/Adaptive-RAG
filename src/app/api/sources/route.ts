import { NextResponse } from "next/server";
import { unauthorized, userFromRequest } from "@/lib/auth/session";
import {
  deleteIndexedFile,
  getVectorStore,
  listIndexedFiles,
} from "@/lib/rag/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return unauthorized();
  try {
    await getVectorStore();
    return NextResponse.json({ files: await listIndexedFiles(user.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list files.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return unauthorized();
  const body = (await request.json()) as { filename?: string };
  const filename = body.filename?.trim();
  if (!filename) {
    return NextResponse.json({ error: "filename is required." }, { status: 400 });
  }

  try {
    const files = await listIndexedFiles(user.id);
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
    const result = await deleteIndexedFile(filename, user.id);
    return NextResponse.json({
      ok: true,
      filename: result.filename,
      files: await listIndexedFiles(user.id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
