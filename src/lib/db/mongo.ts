import { MongoClient, type Db } from "mongodb";

const globalForMongo = globalThis as unknown as {
  mongoClient?: MongoClient;
  mongoConnect?: Promise<MongoClient>;
};

function getUri() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Set MONGODB_URI in .env.local (see .env.example).");
  }
  return uri;
}

export async function getMongoDb(): Promise<Db> {
  if (!globalForMongo.mongoConnect) {
    globalForMongo.mongoConnect = new MongoClient(getUri()).connect();
  }
  globalForMongo.mongoClient = await globalForMongo.mongoConnect;
  const name = process.env.MONGODB_DB ?? "adaptive_rag";
  return globalForMongo.mongoClient.db(name);
}
