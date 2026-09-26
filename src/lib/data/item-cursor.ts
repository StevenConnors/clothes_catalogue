import { z } from "zod";
import { ClothingTypeSchema, ItemIdSchema } from "@/lib/contracts/wardrobe";
import type { ClothingType } from "@/lib/contracts/wardrobe";

const ItemCursorSchema = z.object({
  version: z.literal(1),
  filter: ClothingTypeSchema.nullable(),
  type: ClothingTypeSchema,
  createdAt: z.string().datetime(),
  id: ItemIdSchema,
}).strict();

export class InvalidItemCursorError extends Error {
  constructor() { super("The item cursor is invalid for this filter."); }
}

export function encodeItemCursor(cursor: z.infer<typeof ItemCursorSchema>): string {
  return Buffer.from(JSON.stringify(ItemCursorSchema.parse(cursor))).toString("base64url");
}

export function decodeItemCursor(value: string, type?: ClothingType): z.infer<typeof ItemCursorSchema> {
  try {
    if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new InvalidItemCursorError();
    const cursor = ItemCursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (cursor.filter !== (type ?? null) || (type && cursor.type !== type)) throw new InvalidItemCursorError();
    return cursor;
  } catch {
    throw new InvalidItemCursorError();
  }
}
