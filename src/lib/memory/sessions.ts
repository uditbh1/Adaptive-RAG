import { getMongoDb } from "../db/mongo";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  route?: string;
  trace?: string[];
  createdAt?: Date;
};

type MessageDoc = ChatTurn & {
  sessionId: string;
  createdAt: Date;
};

export async function ensureSession(sessionId: string) {
  const db = await getMongoDb();
  const now = new Date();
  await db.collection("messages").createIndex({ sessionId: 1, createdAt: 1 });
  await db.collection("sessions").createIndex({ sessionId: 1 }, { unique: true });
  await db.collection("sessions").updateOne(
    { sessionId },
    {
      $set: { sessionId, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
}

export async function getSession(sessionId: string): Promise<ChatTurn[]> {
  const db = await getMongoDb();
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
    createdAt: doc.createdAt,
  }));
}

export type ConversationSummary = {
  sessionId: string;
  title: string;
  updatedAt: Date;
  messageCount: number;
};

export async function appendTurn(sessionId: string, turn: ChatTurn) {
  const db = await getMongoDb();
  await ensureSession(sessionId);
  await db.collection<MessageDoc>("messages").insertOne({
    sessionId,
    role: turn.role,
    content: turn.content,
    route: turn.route,
    trace: turn.trace,
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
  return getSession(sessionId);
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const db = await getMongoDb();
  const sessions = await db
    .collection("sessions")
    .find({})
    .sort({ updatedAt: -1 })
    .limit(50)
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
  maxTurns = 16,
): Promise<string> {
  const turns = await getSession(sessionId);
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
