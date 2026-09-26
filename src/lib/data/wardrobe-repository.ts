import { CLOTHING_TYPES, type ClothingType, type ItemDTO } from "@/lib/contracts/wardrobe";
import type { ItemCounts, WardrobeDocument, WardrobeRepository } from "@/lib/contracts/persistence";
import { decodeItemCursor, encodeItemCursor } from "./item-cursor";
import { getDatabase } from "./mongodb";

// Keep the catalogue's category order, with newest items first within each category.
export async function listActiveItemsPage({ type, limit, cursor }: {
  type?: ClothingType; limit: number; cursor?: string;
}): Promise<{ documents: WardrobeDocument[]; nextCursor: string | null }> {
  const after = cursor ? decodeItemCursor(cursor, type) : undefined;
  const categories = type ? [type] : CLOTHING_TYPES.slice(after ? CLOTHING_TYPES.indexOf(after.type) : 0);
  const collection = (await getDatabase()).collection<WardrobeDocument>("wardrobe_items");
  const documents: WardrobeDocument[] = [];
  // Read one extra item to know whether another page exists, including across categories.
  for (const category of categories) {
    const createdAt = after ? new Date(after.createdAt) : undefined;
    const rows = await collection.find({
      deletedAt: null, type: category,
      ...(after && category === after.type ? { $or: [
        { createdAt: { $lt: createdAt } },
        { createdAt, _id: { $lt: after.id } },
      ] } : {}),
    }).sort({ createdAt: -1, _id: -1 }).limit(limit + 1 - documents.length).toArray();
    documents.push(...rows);
    if (documents.length > limit) break;
  }
  const hasMore = documents.length > limit;
  const page = documents.slice(0, limit);
  const last = page.at(-1);
  return {
    documents: page,
    nextCursor: hasMore && last ? encodeItemCursor({
      version: 1, filter: type ?? null, type: last.type, createdAt: last.createdAt.toISOString(), id: last._id,
    }) : null,
  };
}

export function toItemDTO(document: WardrobeDocument): ItemDTO {
  return {
    id: document._id,
    type: document.type,
    images: {
      cutout: `/api/items/${document._id}/image?variant=cutout`,
      original: `/api/items/${document._id}/image?variant=original`,
    },
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export function getWardrobeRepository(): WardrobeRepository {
  const collection = async () => (await getDatabase()).collection<WardrobeDocument>("wardrobe_items");
  return {
    async listActive(type) {
      return (await collection()).find({ deletedAt: null, ...(type ? { type } : {}) })
        .sort({ createdAt: -1, _id: -1 }).toArray();
    },
    async countActiveByType() {
      const rows = await (await collection()).aggregate<{ _id: string; count: number }>([
        { $match: { deletedAt: null } }, { $group: { _id: "$type", count: { $sum: 1 } } },
      ]).toArray();
      const counts = Object.fromEntries(CLOTHING_TYPES.map((type) => [type, 0])) as ItemCounts;
      for (const row of rows) if (CLOTHING_TYPES.includes(row._id as (typeof CLOTHING_TYPES)[number])) counts[row._id as keyof ItemCounts] = row.count;
      return counts;
    },
    async getActiveById(id) { return (await collection()).findOne({ _id: id, deletedAt: null }); },
    async findBySourceHash(hash) { return (await collection()).findOne({ sourceSha256: hash }); },
    async insertIfAbsent(document) {
      const items = await collection();
      try {
        await items.insertOne(document);
        return { inserted: true, document };
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        const existing = await items.findOne({ sourceSha256: document.sourceSha256 });
        if (!existing) throw error;
        return { inserted: false, document: existing };
      }
    },
    async updateType(id, type) {
      const now = new Date();
      return (await collection()).findOneAndUpdate(
        { _id: id, deletedAt: null }, { $set: { type, updatedAt: now } }, { returnDocument: "after" },
      );
    },
    async softDelete(id) {
      const items = await collection();
      const existing = await items.findOne({ _id: id });
      if (!existing) return false;
      if (existing.deletedAt === null) await items.updateOne({ _id: id, deletedAt: null }, { $set: { deletedAt: new Date() } });
      return true;
    },
  };
}
