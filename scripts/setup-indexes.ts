import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { closeDatabase, getDatabase } from "../src/lib/data/mongodb";

async function main() {
  try {
    const collection = (await getDatabase()).collection("wardrobe_items");
    await collection.createIndex({ sourceSha256: 1 }, { unique: true, name: "sourceSha256_unique" });
    await collection.createIndex({ deletedAt: 1, createdAt: -1, _id: -1 }, { name: "active_items_newest" });
    await collection.createIndex({ deletedAt: 1, type: 1, createdAt: -1, _id: -1 }, { name: "active_items_by_type_newest" });
    console.log("Wardrobe indexes are ready.");
  } finally {
    await closeDatabase();
  }
}
main().catch((error) => { console.error("Unable to create wardrobe indexes.", error); process.exitCode = 1; });
