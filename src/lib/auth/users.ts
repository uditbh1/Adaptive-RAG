import { ObjectId } from "mongodb";
import { getMongoDb } from "../db/mongo";
import { hashPassword, verifyPassword } from "./password";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  if (email.length > 200 || !EMAIL_RE.test(email)) return "";
  return email;
}

export function normalizePassword(value: unknown) {
  if (typeof value !== "string") return "";
  const password = value.trim();
  if (password.length < 8 || password.length > 200) return "";
  return password;
}

export async function signup(email: string, password: string) {
  const db = await getMongoDb();
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  try {
    const result = await db.collection("users").insertOne({
      email,
      passwordHash: await hashPassword(password),
      createdAt: new Date(),
    });
    return { id: result.insertedId.toHexString(), email };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: number }).code === 11000
    ) {
      throw new Error("An account with that email already exists.");
    }
    throw error;
  }
}

export async function login(email: string, password: string) {
  const db = await getMongoDb();
  const user = await db.collection("users").findOne({ email });
  const hash = typeof user?.passwordHash === "string" ? user.passwordHash : "";
  const ok = hash ? await verifyPassword(password, hash) : false;
  if (!user || !ok) {
    throw new Error("Email or password is incorrect.");
  }
  return { id: (user._id as ObjectId).toHexString(), email };
}
