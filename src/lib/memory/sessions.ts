import { getMongoDb } from "../db/mongo";

export class SessionAccessError extends Error {
  constructor() {
    super("Chat not found.");
    this.name = "SessionAccessError";
  }
}

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  userId?: string;
  route?: string;
  trace?: string[];
  sources?: string[];
  metrics?: Array<{ name: string; ms: number; tokens?: number }>;
  provenance?: {
    kind: "files" | "web" | "mixed" | "model";
    label: string;
    fileSources: string[];
    webSources: string[];
    quote?: { source: string; text: string };
  };
  createdAt?: Date;
};

type MessageDoc = ChatTurn & {
  sessionId: string;
  createdAt: Date;
};

async function claimSession(sessionId: string, userId: string) {
  const db = await getMongoDb();
  const now = new Date();
  await db.collection("messages").createIndex({ sessionId: 1, createdAt: 1 });
  await db.collection("sessions").createIndex({ sessionId: 1 }, { unique: true });
  await db.collection("sessions").createIndex({ userId: 1, updatedAt: -1 });
  const existing = await db.collection("sessions").findOne({ sessionId });
  if (existing) {
    if (String(existing.userId ?? "") !== userId) {
      throw new SessionAccessError();
    }
    await db.collection("sessions").updateOne({ sessionId }, { $set: { updatedAt: now } });
    return;
  }
  try {
    await db.collection("sessions").insertOne({
      sessionId,
      userId,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: number }).code === 11000
    ) {
      const raced = await db.collection("sessions").findOne({ sessionId });
      if (raced && String(raced.userId ?? "") === userId) return;
    }
    throw error;
  }
}

export async function getSession(sessionId: string, userId: string): Promise<ChatTurn[]> {
  const db = await getMongoDb();
  const existing = await db.collection("sessions").findOne({ sessionId });
  if (!existing) return [];
  if (String(existing.userId ?? "") !== userId) {
    throw new SessionAccessError();
  }
  const docs = await db
    .collection<MessageDoc>("messages")
    .find({ sessionId })
    .sort({ createdAt: 1 })
    .toArray();

  return docs.map((doc) => ({
    role: doc.role,
    content: doc.content,
    route: doc.route,
    trace: doc.trace,
    sources: doc.sources,
    metrics: doc.metrics,
    provenance: doc.provenance,
    createdAt: doc.createdAt,
  }));
}

export type ConversationSummary = {
  sessionId: string;
  title: string;
  updatedAt: Date;
  messageCount: number;
};

export async function appendTurn(sessionId: string, userId: string, turn: ChatTurn) {
  const db = await getMongoDb();
  await claimSession(sessionId, userId);
  await db.collection<MessageDoc>("messages").insertOne({
    sessionId,
    userId,
    role: turn.role,
    content: turn.content,
    route: turn.route,
    trace: turn.trace,
    sources: turn.sources,
    metrics: turn.metrics,
    provenance: turn.provenance,
    createdAt: new Date(),
  });

  const sessionUpdate: { updatedAt: Date; title?: string } = {
    updatedAt: new Date(),
  };
  if (turn.role === "user") {
    const existing = await db.collection("sessions").findOne({ sessionId });
    if (!existing?.title) {
      sessionUpdate.title = turn.content.trim().slice(0, 80) || "Conversation";
    }
  }

  await db.collection("sessions").updateOne({ sessionId }, { $set: sessionUpdate });
  return getSession(sessionId, userId);
}

const MAX_LISTED_SESSIONS = 50;
const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSessionId(value: unknown): string {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return SESSION_ID_RE.test(id) ? id : "";
}

export function parseSessionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    const id = parseSessionId(item);
    if (!id || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= MAX_LISTED_SESSIONS) break;
  }
  return ids;
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  if (!userId) return [];

  const db = await getMongoDb();
  const sessions = await db
    .collection("sessions")
    .find({ userId })
    .sort({ updatedAt: -1 })
    .limit(MAX_LISTED_SESSIONS)
    .toArray();

  const summaries: ConversationSummary[] = [];
  for (const session of sessions) {
    const sessionId = String(session.sessionId);
    const messageCount = await db.collection("messages").countDocuments({ sessionId });
    if (messageCount === 0) {
      continue;
    }
    const firstUser = await db.collection<MessageDoc>("messages").findOne(
      { sessionId, role: "user" },
      { sort: { createdAt: 1 } },
    );
    summaries.push({
      sessionId,
      title:
        (typeof session.title === "string" && session.title) ||
        firstUser?.content.trim().slice(0, 80) ||
        "Conversation",
      updatedAt: session.updatedAt instanceof Date ? session.updatedAt : new Date(),
      messageCount,
    });
  }
  return summaries;
}

export async function formatHistory(
  sessionId: string,
  userId: string,
  maxTurns = 16,
): Promise<string> {
  const turns = await getSession(sessionId, userId);
  const recent = turns.slice(-maxTurns);
  if (recent.length === 0) {
    return "";
  }
  return recent
    .map((turn) => {
      const body =
        turn.content.length > 800
          ? `${turn.content.slice(0, 800)}…`
          : turn.content;
      return `${turn.role === "user" ? "User" : "Assistant"}: ${body}`;
    })
    .join("\n");
}
