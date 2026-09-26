import { MongoClient, type Db } from "mongodb";

const globalMongo = globalThis as typeof globalThis & { __wardrobeMongo?: Promise<MongoClient> };

export async function getDatabase(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  const name = process.env.MONGODB_DB;
  if (!uri || !name) {
    const error = new Error("MongoDB is not configured.");
    error.name = "ServiceUnavailableError";
    throw error;
  }
  const connection = globalMongo.__wardrobeMongo ?? new MongoClient(uri).connect();
  globalMongo.__wardrobeMongo = connection;
  try {
    return (await connection).db(name);
  } catch (error) {
    globalMongo.__wardrobeMongo = undefined;
    throw error;
  }
}

export async function closeDatabase(): Promise<void> {
  const connection = globalMongo.__wardrobeMongo;
  globalMongo.__wardrobeMongo = undefined;
  if (!connection) return;
  try {
    await (await connection).close();
  } catch {
    // A failed connection has no live client to close.
  }
}
