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
  await db.collection("sessions").updateOne(
    { sessionId },
    { $set: { updatedAt: new Date() } },
  );
  return getSession(sessionId);
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
