import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { QdrantClient } from "@qdrant/js-client-rest";
import { Document } from "@langchain/core/documents";
import { QdrantVectorStore } from "@langchain/qdrant";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { getEmbeddings } from "../llm";

const DATA_DIR = path.join(process.cwd(), "data");
const SAMPLE_DIR = path.join(DATA_DIR, "sample");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

function docOrigin(metadata: Record<string, unknown>) {
  return String(metadata.origin ?? "upload");
}

function docUserId(metadata: Record<string, unknown>) {
  return String(metadata.userId ?? "");
}

function isVisibleDoc(
  metadata: Record<string, unknown>,
  userId: string,
) {
  const owner = docUserId(metadata);
  if (owner) return owner === userId;
  if (docOrigin(metadata) === "upload") return false;
  return true;
}

function filterVisibleDocs<T extends { metadata: Record<string, unknown> }>(
  docs: T[],
  userId: string,
) {
  return docs.filter((doc) => isVisibleDoc(doc.metadata, userId));
}

type QdrantCondition = Record<string, unknown>;

function visibilityFilter(userId: string): { should: QdrantCondition[] } {
  const sample: QdrantCondition[] = [
    { key: "origin", match: { value: "sample" } },
    { key: "metadata.origin", match: { value: "sample" } },
  ];
  if (!userId) {
    return { should: sample };
  }
  return {
    should: [
      ...sample,
      { key: "userId", match: { value: userId } },
      { key: "metadata.userId", match: { value: userId } },
    ],
  };
}

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
  const client = getClient();
  try {
    await client.createPayloadIndex(collectionName, {
      wait: true,
      field_name: "content",
      field_schema: "text",
    });
  } catch {
    // index already exists
  }
  for (const field_name of [
    "origin",
    "userId",
    "sessionId",
    "metadata.origin",
    "metadata.userId",
    "metadata.sessionId",
  ]) {
    try {
      await client.createPayloadIndex(collectionName, {
        wait: true,
        field_name,
        field_schema: "keyword",
      });
    } catch {
      // index already exists or payload path is unused
    }
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

export async function countVisibleChunks(userId: string) {
  if (!(await collectionExists())) return 0;
  let count = 0;
  for (const point of await scrollPoints()) {
    const doc = payloadToDoc(point);
    if (doc && isVisibleDoc(doc.metadata, userId)) count += 1;
  }
  return count;
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
  await seedSampleDocuments();
  return vectorStore;
}

export async function seedSampleDocuments() {
  const names = (await fs.readdir(SAMPLE_DIR))
    .filter((name) => name.toLowerCase().endsWith(".txt"))
    .sort();
  const indexed = new Set(
    (await listIndexedSources()).map((source) => source.toLowerCase()),
  );
  let added = 0;
  for (const name of names) {
    if (indexed.has(name.toLowerCase())) continue;
    const text = await fs.readFile(path.join(SAMPLE_DIR, name), "utf8");
    added += await addTextDocument(text, {
      source: name,
      origin: "sample",
    });
    indexed.add(name.toLowerCase());
  }
  return added;
}

export async function seedSampleDocument() {
  return seedSampleDocuments();
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

function uploadDiskPath(userId: string, safeName: string) {
  return path.join(UPLOAD_DIR, userId, safeName);
}

async function writeCanonicalUpload(userId: string, safeName: string, text: string) {
  try {
    const dir = path.join(UPLOAD_DIR, userId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(uploadDiskPath(userId, safeName), text, "utf8");
  } catch {
    // Vercel disk is ephemeral or read-only. Qdrant is the index.
  }
}

async function collapseTimestampedUploads() {
  let files: string[] = [];
  try {
    files = await fs.readdir(UPLOAD_DIR);
  } catch {
    return;
  }
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
      try {
        await fs.rename(from, dest);
      } catch {
        // ignore disk errors
      }
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

async function deleteUploadSource(source: string, userId: string) {
  if (!userId) return;
  const ids: Array<string | number> = [];
  for (const point of await scrollPoints()) {
    const doc = payloadToDoc(point);
    if (!doc) continue;
    const sameSource =
      String(doc.metadata.source ?? "").toLowerCase() === source.toLowerCase();
    const origin = docOrigin(doc.metadata);
    if (sameSource && origin === "upload" && docUserId(doc.metadata) === userId) {
      ids.push(point.id);
    }
  }
  await deletePoints(ids);
}

export async function reconcileUploads() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await collapseTimestampedUploads();
  } catch {
    // ignore disk
  }
  if (!(await collectionExists())) return;

  const groups = new Map<string, { id: string | number; origin: string }[]>();
  for (const point of await scrollPoints()) {
    const doc = payloadToDoc(point);
    if (!doc) continue;
    const source = String(doc.metadata.source ?? "").toLowerCase();
    if (!source) continue;
    const origin = docOrigin(doc.metadata);
    const owner = origin === "sample" ? "sample" : docUserId(doc.metadata) || "unowned";
    const key = `${origin}::${owner}::${source}::${normalizeText(doc.pageContent)}`;
    const list = groups.get(key) ?? [];
    list.push({ id: point.id, origin });
    groups.set(key, list);
  }

  const extraIds: Array<string | number> = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    extraIds.push(...list.slice(1).map((item) => item.id));
  }
  await deletePoints(extraIds);
}

export async function saveUpload(
  filename: string,
  text: string,
  userId: string,
  sessionId = "",
) {
  if (!userId) {
    throw new Error("Sign in required.");
  }
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  await writeCanonicalUpload(userId, safeName, text);
  await reconcileUploads();

  const existing = await retrieveBySources([safeName], userId);
  if (existing.length > 0 && uploadMatchesText(safeName, text, existing)) {
    return { filename: safeName, chunks: existing.length, reused: true };
  }

  await deleteUploadSource(safeName, userId);
  const chunks = await addTextDocument(text, {
    source: safeName,
    origin: "upload",
    userId,
    sessionId,
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
  const nested =
    payload.metadata && typeof payload.metadata === "object"
      ? (payload.metadata as Record<string, unknown>)
      : {};
  const metadata: Record<string, unknown> = { ...nested };
  for (const key of ["source", "origin", "userId", "sessionId", "contentHash"]) {
    if (metadata[key] == null && payload[key] != null) {
      metadata[key] = payload[key];
    }
  }
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

export async function listIndexedSources(ownerId = "") {
  if (!(await collectionExists())) return [];
  const sources = new Set<string>();
  for (const point of await scrollPoints()) {
    const doc = payloadToDoc(point);
    if (!doc || !isVisibleDoc(doc.metadata, ownerId)) continue;
    const source = doc.metadata.source;
    if (typeof source === "string" && source.trim()) {
      sources.add(source);
    }
  }
  return [...sources];
}

export async function retrieveBySources(sources: string[], ownerId = "") {
  const wanted = new Set(sources.map((source) => source.toLowerCase()));
  const docs = [];
  for (const point of await scrollPoints()) {
    const doc = payloadToDoc(point);
    if (!doc) continue;
    if (!isVisibleDoc(doc.metadata, ownerId)) continue;
    if (wanted.has(String(doc.metadata.source ?? "").toLowerCase())) {
      docs.push(doc);
    }
  }
  return dedupeDocs(docs);
}

const KEYWORD_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "what",
  "does",
  "how",
  "who",
  "are",
  "was",
  "can",
  "may",
  "from",
  "into",
  "about",
  "your",
  "you",
  "not",
  "any",
  "its",
  "has",
  "have",
  "will",
  "when",
  "where",
  "which",
  "than",
  "then",
  "them",
  "they",
  "our",
  "out",
  "all",
  "but",
  "did",
  "get",
  "use",
  "using",
  "according",
]);

function keywordTerms(query: string) {
  const splitCamel = query.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  const words = [
    ...(query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []),
    ...(splitCamel.match(/[a-z0-9]{4,}/g) ?? []),
  ];
  return [...new Set(words)]
    .filter((word) => !KEYWORD_STOP_WORDS.has(word))
    .sort((left, right) => right.length - left.length)
    .slice(0, 6);
}

function lexicalScore(content: string, terms: string[]) {
  const haystack = content.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += term.length;
  }
  return score;
}

async function scrollKeyword(word: string, limit: number, ownerId: string) {
  const { collectionName } = qdrantOptions();
  const result = await getClient().scroll(collectionName, {
    limit,
    with_payload: true,
    with_vector: false,
    filter: {
      must: [
        { key: "content", match: { text: word } },
        visibilityFilter(ownerId),
      ],
    },
  });
  return filterVisibleDocs(
    result.points
      .map((point) => payloadToDoc(point))
      .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc)),
    ownerId,
  );
}

async function keywordSearch(query: string, k: number, ownerId: string) {
  const terms = keywordTerms(query);
  if (terms.length === 0) return [];

  let docs: Array<{ pageContent: string; metadata: Record<string, unknown> }> = [];
  try {
    const batches = await Promise.all(
      terms.slice(0, 3).map((word) => scrollKeyword(word, Math.max(k, 12), ownerId)),
    );
    docs = dedupeDocs(batches.flat());
  } catch {
    docs = [];
  }

  const rarest = terms[0];
  if (
    rarest.length >= 8 &&
    !docs.some((doc) => doc.pageContent.toLowerCase().includes(rarest))
  ) {
    const scanned = [];
    for (const point of await scrollPoints()) {
      const doc = payloadToDoc(point);
      if (!doc || !isVisibleDoc(doc.metadata, ownerId)) continue;
      if (doc.pageContent.toLowerCase().includes(rarest)) scanned.push(doc);
    }
    docs = dedupeDocs([...scanned, ...docs]);
  }

  return docs
    .map((doc) => ({ doc, score: lexicalScore(doc.pageContent, terms) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, k)
    .map((item) => item.doc);
}

export async function peekDocuments(query: string, userId = "", k = 4) {
  return retrieveDocuments(query, k, query, undefined, userId);
}

async function vectorSearch(query: string, k: number, ownerId: string) {
  const vector = await getEmbeddings().embedQuery(query);
  const { collectionName } = qdrantOptions();
  try {
    const result = await getClient().query(collectionName, {
      query: vector,
      limit: k,
      filter: visibilityFilter(ownerId),
      with_payload: true,
    });
    const points = result.points ?? [];
    return filterVisibleDocs(
      points
        .map((point) => payloadToDoc(point))
        .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc)),
      ownerId,
    );
  } catch {
    const store = await getVectorStore();
    return filterVisibleDocs(
      (await store.similaritySearch(query, k)).map((doc) => ({
        pageContent: doc.pageContent,
        metadata: (doc.metadata ?? {}) as Record<string, unknown>,
      })),
      ownerId,
    );
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
  lockedFile?: string,
  userId = "",
) {
  await getVectorStore();
  if (lockedFile?.trim()) {
    return retrieveBySources([lockedFile.trim()], userId);
  }

  const asked = originalQuestion?.trim() || query;
  const namedSources = matchSources(
    `${asked}\n${query}`,
    await listIndexedSources(userId),
  );
  if (namedSources.length > 0) {
    const named = await retrieveBySources(namedSources, userId);
    if (named.length > 0) {
      return named;
    }
  }

  const fetchK = Math.max(k * 8, 24);
  const [vectorHits, keywordHits] = await Promise.all([
    vectorSearch(query, fetchK, userId),
    keywordSearch(query, fetchK, userId),
  ]);
  const terms = keywordTerms(`${asked}\n${query}`);
  return rrfFuse([vectorHits, keywordHits], k)
    .map((doc) => ({ doc, score: lexicalScore(doc.pageContent, terms) }))
    .sort((left, right) => right.score - left.score)
    .map((item) => item.doc);
}

export type IndexedFile = {
  filename: string;
  origin: string;
  chunks: number;
  canDelete: boolean;
};

export async function listIndexedFiles(userId = ""): Promise<IndexedFile[]> {
  if (!(await collectionExists())) return [];
  const grouped = new Map<string, IndexedFile>();
  for (const point of await scrollPoints()) {
    const doc = payloadToDoc(point);
    if (!doc || !isVisibleDoc(doc.metadata, userId)) continue;
    const filename = String(doc.metadata.source ?? "").trim();
    if (!filename) continue;
    const origin = docOrigin(doc.metadata);
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

export async function deleteIndexedFile(filename: string, userId: string) {
  if (!userId) {
    throw new Error("Sign in required.");
  }
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  await deleteUploadSource(safeName, userId);
  try {
    await fs.unlink(uploadDiskPath(userId, safeName));
  } catch {
    try {
      await fs.unlink(path.join(UPLOAD_DIR, safeName));
    } catch {
      // disk copy may already be gone
    }
  }
  return { filename: safeName };
}
