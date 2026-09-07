import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { QdrantClient } from "@qdrant/js-client-rest";
import { Document } from "@langchain/core/documents";
import { QdrantVectorStore } from "@langchain/qdrant";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { getEmbeddings } from "../llm";

const DATA_DIR = path.join(process.cwd(), "data");
const SAMPLE_PATH = path.join(DATA_DIR, "sample", "azure-ai.txt");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 150,
});

let vectorStore: QdrantVectorStore | null = null;

function qdrantOptions() {
  const url = process.env.QDRANT_URL;
  if (!url) {
    throw new Error("Set QDRANT_URL in .env.local (see .env.example).");
  }
  return {
    url,
    apiKey: process.env.QDRANT_API_KEY || undefined,
    collectionName: process.env.QDRANT_COLLECTION ?? "adaptive_rag_docs",
  };
}

function getClient() {
  const { url, apiKey } = qdrantOptions();
  return new QdrantClient({ url, apiKey });
}

async function collectionExists() {
  const client = getClient();
  const { collectionName } = qdrantOptions();
  const { collections } = await client.getCollections();
  return collections.some((item) => item.name === collectionName);
}

async function ensureTextIndex() {
  const { collectionName } = qdrantOptions();
  try {
    await getClient().createPayloadIndex(collectionName, {
      wait: true,
      field_name: "content",
      field_schema: "text",
    });
  } catch {
    // index already exists
  }
}

async function ensureCollection() {
  const embeddings = getEmbeddings();
  const options = qdrantOptions();
  if (!(await collectionExists())) {
    const size = (await embeddings.embedQuery("dimension probe")).length;
    await getClient().createCollection(options.collectionName, {
      vectors: { size, distance: "Cosine" },
    });
  }
  await ensureTextIndex();
  return QdrantVectorStore.fromExistingCollection(embeddings, options);
}

export async function getChunkCount() {
  try {
    if (!(await collectionExists())) {
      return 0;
    }
    const { collectionName } = qdrantOptions();
    const info = await getClient().getCollection(collectionName);
    return Number(info.points_count ?? 0);
  } catch {
    return 0;
  }
}

export async function getVectorStore() {
  if (!vectorStore) {
    vectorStore = await ensureCollection();
  }
  if ((await getChunkCount()) === 0) {
    await seedSampleDocument();
  }
  return vectorStore;
}

export async function seedSampleDocument() {
  const text = await fs.readFile(SAMPLE_PATH, "utf8");
  return addTextDocument(text, {
    source: "azure-ai.txt",
    origin: "sample",
  });
}

export async function addTextDocument(
  text: string,
  metadata: Record<string, unknown>,
) {
  const store = vectorStore ?? (await ensureCollection());
  vectorStore = store;
  const source = typeof metadata.source === "string" ? metadata.source : "";
  const labeled = source ? `Source file: ${source}\n\n${text}` : text;
  const docs = await splitter.createDocuments([labeled], [metadata]);
  await store.addDocuments(
    docs.map(
      (doc) =>
        new Document({
          pageContent: doc.pageContent,
          metadata: doc.metadata,
        }),
    ),
  );
  return docs.length;
}

function hashText(text: string) {
  return createHash("sha256").update(normalizeText(text)).digest("hex");
}

function normalizeText(text: string) {
  return text.replace(/\r\n/g, "\n").trim();
}

function uploadMatchesText(
  source: string,
  text: string,
  docs: Array<{ pageContent: string }>,
) {
  const normalized = normalizeText(text);
  const labeled = normalizeText(`Source file: ${source}\n\n${text}`);
  return docs.some((doc) => {
    const content = normalizeText(doc.pageContent);
    return (
      content === normalized ||
      content === labeled ||
      content.includes(normalized)
    );
  });
}

async function writeCanonicalUpload(safeName: string, text: string) {
  await fs.writeFile(path.join(UPLOAD_DIR, safeName), text, "utf8");
}

async function collapseTimestampedUploads() {
  const files = await fs.readdir(UPLOAD_DIR);
  const stamped = /^(\d{10,})-(.+\.txt)$/i;
  for (const file of files) {
    const match = file.match(stamped);
    if (!match) continue;
    const from = path.join(UPLOAD_DIR, file);
    const dest = path.join(UPLOAD_DIR, match[2]);
    try {
      await fs.access(dest);
      await fs.unlink(from);
    } catch {
      await fs.rename(from, dest);
    }
  }
}

async function deletePoints(ids: Array<string | number>) {
  if (ids.length === 0) return;
  const { collectionName } = qdrantOptions();
  await getClient().delete(collectionName, {
    wait: true,
    points: ids,
  });
}

async function deleteUploadSource(source: string) {
  const ids: Array<string | number> = [];
  for (const point of await scrollPoints()) {
    const doc = payloadToDoc(point);
    if (!doc) continue;
    const sameSource =
      String(doc.metadata.source ?? "").toLowerCase() === source.toLowerCase();
    const origin = String(doc.metadata.origin ?? "");
    if (sameSource && origin === "upload") {
      ids.push(point.id);
    }
  }
  await deletePoints(ids);
}

export async function reconcileUploads() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await collapseTimestampedUploads();
  if (!(await collectionExists())) return;

  const groups = new Map<string, { id: string | number; origin: string }[]>();
  for (const point of await scrollPoints()) {
    const doc = payloadToDoc(point);
    if (!doc) continue;
    const source = String(doc.metadata.source ?? "").toLowerCase();
    if (!source) continue;
    const key = `${source}::${normalizeText(doc.pageContent)}`;
    const list = groups.get(key) ?? [];
    list.push({ id: point.id, origin: String(doc.metadata.origin ?? "") });
    groups.set(key, list);
  }

  const extraIds: Array<string | number> = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => Number(b.origin === "sample") - Number(a.origin === "sample"));
    extraIds.push(...list.slice(1).map((item) => item.id));
  }
  await deletePoints(extraIds);
}

export async function saveUpload(filename: string, text: string) {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  await writeCanonicalUpload(safeName, text);
  await reconcileUploads();

  const existing = await retrieveBySources([safeName]);
  if (existing.length > 0 && uploadMatchesText(safeName, text, existing)) {
    return { filename: safeName, chunks: existing.length, reused: true };
  }

  await deleteUploadSource(safeName);
  const chunks = await addTextDocument(text, {
    source: safeName,
    origin: "upload",
    contentHash: hashText(text),
  });
  return { filename: safeName, chunks, reused: false };
}

export function normalizeSourceName(value: string) {
  return value.toLowerCase().replace(/\.txt$/i, "").replace(/[^a-z0-9]/g, "");
}

export function matchSources(question: string, sources: string[]): string[] {
  const mentions = question.match(/[a-zA-Z0-9._-]+\.txt/gi) ?? [];
  const tokens = [question, ...mentions]
    .map(normalizeSourceName)
    .filter((token) => token.length >= 5);

  return sources.filter((source) => {
    const compact = normalizeSourceName(source);
    if (compact.length < 4) return false;
    return tokens.some((token) => token.includes(compact) || compact.includes(token));
  });
}

function payloadToDoc(point: { payload?: Record<string, unknown> | null }) {
  const payload = point.payload;
  if (!payload) return null;
  const content = typeof payload.content === "string" ? payload.content : "";
  if (!content.trim()) return null;
  const metadata =
    payload.metadata && typeof payload.metadata === "object"
      ? (payload.metadata as Record<string, unknown>)
      : {};
  return { pageContent: content, metadata };
}

function docKey(doc: { pageContent: string; metadata: Record<string, unknown> }) {
  return `${String(doc.metadata.source ?? "")}::${doc.pageContent}`;
}

function dedupeDocs<T extends { pageContent: string; metadata: Record<string, unknown> }>(
  docs: T[],
) {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const doc of docs) {
    const key = docKey(doc);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(doc);
  }
  return unique;
}

async function scrollPoints() {
  const client = getClient();
  const { collectionName } = qdrantOptions();
  const points: Array<{
    id: string | number;
    payload?: Record<string, unknown> | null;
  }> = [];
  let offset: unknown;
  for (let page = 0; page < 20; page += 1) {
    const result = await client.scroll(collectionName, {
      limit: 100,
      offset: offset as never,
      with_payload: true,
      with_vector: false,
    });
    points.push(
      ...result.points.map((point) => ({
        id: point.id as string | number,
        payload: (point.payload ?? null) as Record<string, unknown> | null,
      })),
    );
    if (result.next_page_offset == null) break;
    offset = result.next_page_offset;
  }
  return points;
}

export async function listIndexedSources() {
  if (!(await collectionExists())) return [];
  const sources = new Set<string>();
  for (const point of await scrollPoints()) {
    const source = payloadToDoc(point)?.metadata.source;
    if (typeof source === "string" && source.trim()) {
      sources.add(source);
    }
  }
  return [...sources];
}

export async function retrieveBySources(sources: string[]) {
  const wanted = new Set(sources.map((source) => source.toLowerCase()));
  const docs = [];
  for (const point of await scrollPoints()) {
    const doc = payloadToDoc(point);
    if (!doc) continue;
    if (wanted.has(String(doc.metadata.source ?? "").toLowerCase())) {
      docs.push(doc);
    }
  }
  return dedupeDocs(docs);
}

async function keywordSearch(query: string, k: number) {
  const words = [
    ...new Set((query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])),
  ].slice(0, 8);
  if (words.length === 0) return [];

  const { collectionName } = qdrantOptions();
  try {
    const result = await getClient().scroll(collectionName, {
      limit: Math.max(k, 6),
      with_payload: true,
      with_vector: false,
      filter: {
        should: words.map((word) => ({
          key: "content",
          match: { text: word },
        })),
      },
    });
    return result.points
      .map((point) => payloadToDoc(point))
      .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc));
  } catch {
    const docs = [];
    for (const point of await scrollPoints()) {
      const doc = payloadToDoc(point);
      if (!doc) continue;
      const haystack = doc.pageContent.toLowerCase();
      if (words.some((word) => haystack.includes(word))) {
        docs.push(doc);
      }
    }
    return docs.slice(0, k);
  }
}

function rrfFuse(
  lists: Array<Array<{ pageContent: string; metadata: Record<string, unknown> }>>,
  k: number,
) {
  const scores = new Map<
    string,
    { doc: { pageContent: string; metadata: Record<string, unknown> }; score: number }
  >();
  for (const list of lists) {
    list.forEach((doc, rank) => {
      const key = docKey(doc);
      const add = 1 / (60 + rank + 1);
      const current = scores.get(key);
      if (current) {
        current.score += add;
      } else {
        scores.set(key, { doc, score: add });
      }
    });
  }
  return [...scores.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, k)
    .map((item) => item.doc);
}

export async function retrieveDocuments(
  query: string,
  k = 4,
  originalQuestion?: string,
) {
  const store = await getVectorStore();
  const asked = originalQuestion?.trim() || query;
  const namedSources = matchSources(
    `${asked}\n${query}`,
    await listIndexedSources(),
  );
  if (namedSources.length > 0) {
    const named = await retrieveBySources(namedSources);
    if (named.length > 0) {
      return named;
    }
  }

  const [vectorHits, keywordHits] = await Promise.all([
    store.similaritySearch(query, k),
    keywordSearch(query, k),
  ]);
  const vectorDocs = vectorHits.map((doc) => ({
    pageContent: doc.pageContent,
    metadata: (doc.metadata ?? {}) as Record<string, unknown>,
  }));
  return rrfFuse([vectorDocs, keywordHits], k);
}

export type IndexedFile = {
  filename: string;
  origin: string;
  chunks: number;
  canDelete: boolean;
};

export async function listIndexedFiles(): Promise<IndexedFile[]> {
  if (!(await collectionExists())) return [];
  const grouped = new Map<string, IndexedFile>();
  for (const point of await scrollPoints()) {
    const doc = payloadToDoc(point);
    const filename = String(doc?.metadata.source ?? "").trim();
    if (!filename) continue;
    const origin = String(doc?.metadata.origin ?? "upload");
    const key = `${origin}::${filename.toLowerCase()}`;
    const current = grouped.get(key);
    if (current) {
      current.chunks += 1;
    } else {
      grouped.set(key, {
        filename,
        origin,
        chunks: 1,
        canDelete: origin === "upload",
      });
    }
  }
  return [...grouped.values()].sort((left, right) =>
    left.filename.localeCompare(right.filename),
  );
}

export async function deleteIndexedFile(filename: string) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  await deleteUploadSource(safeName);
  try {
    await fs.unlink(path.join(UPLOAD_DIR, safeName));
  } catch {
    // disk copy may already be gone
  }
  return { filename: safeName };
}
