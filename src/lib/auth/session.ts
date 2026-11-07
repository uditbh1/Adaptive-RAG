import { createHash, randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getMongoDb } from "../db/mongo";

const COOKIE = "adaptive-rag-auth";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type AuthUser = {
  id: string;
  email: string;
};

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export function readAuthToken(request: Request) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${COOKIE}=`)) continue;
    return decodeURIComponent(trimmed.slice(COOKIE.length + 1));
  }
  return "";
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createAuthSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const db = await getMongoDb();
  await db.collection("authSessions").createIndex({ tokenHash: 1 }, { unique: true });
  await db.collection("authSessions").createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 },
  );
  await db.collection("authSessions").insertOne({
    tokenHash: tokenHash(token),
    userId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + MAX_AGE_SECONDS * 1000),
  });
  return token;
}

export function withAuthCookie(response: NextResponse, token: string) {
  response.cookies.set(COOKIE, token, cookieOptions(MAX_AGE_SECONDS));
  return response;
}

export function withoutAuthCookie(response: NextResponse) {
  response.cookies.set(COOKIE, "", cookieOptions(0));
  return response;
}

export async function userFromRequest(request: Request): Promise<AuthUser | null> {
  const token = readAuthToken(request);
  if (!token) return null;
  const db = await getMongoDb();
  const session = await db.collection("authSessions").findOne({
    tokenHash: tokenHash(token),
    expiresAt: { $gt: new Date() },
  });
  if (!session || typeof session.userId !== "string" || !ObjectId.isValid(session.userId)) {
    return null;
  }
  const user = await db.collection("users").findOne({ _id: new ObjectId(session.userId) });
  if (!user || typeof user.email !== "string") return null;
  return { id: user._id.toHexString(), email: user.email };
}

export async function destroyAuthSession(request: Request) {
  const token = readAuthToken(request);
  if (!token) return;
  const db = await getMongoDb();
  await db.collection("authSessions").deleteOne({ tokenHash: tokenHash(token) });
}

export function unauthorized() {
  return NextResponse.json({ error: "Sign in required." }, { status: 401 });
}
