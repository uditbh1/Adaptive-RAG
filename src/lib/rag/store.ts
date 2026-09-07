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

async function ensureCollection() {
  const embeddings = getEmbeddings();
  const options = qdrantOptions();
  if (await collectionExists()) {
    return QdrantVectorStore.fromExistingCollection(embeddings, options);
  }

  const size = (await embeddings.embedQuery("dimension probe")).length;
  await getClient().createCollection(options.collectionName, {
    vectors: { size, distance: "Cosine" },
  });
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
  const docs = await splitter.createDocuments([text], [metadata]);
  await store.addDocuments(
    docs.map(
      (doc) =>
        new Document({
          pageContent: doc.pageContent,
          metadata: doc.metadata,
        }),
    ),
  );
  return getChunkCount();
}

export async function saveUpload(filename: string, text: string) {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const dest = path.join(UPLOAD_DIR, `${Date.now()}-${safeName}`);
  await fs.writeFile(dest, text, "utf8");
  const chunks = await addTextDocument(text, {
    source: safeName,
    origin: "upload",
  });
  return { filename: safeName, chunks };
}

export async function retrieveDocuments(query: string, k = 4) {
  const store = await getVectorStore();
  const results = await store.similaritySearch(query, k);
  return results.map((doc) => ({
    pageContent: doc.pageContent,
    metadata: (doc.metadata ?? {}) as Record<string, unknown>,
  }));
}
