import { toDeliveryItems } from "@/lib/storage/delivery";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
import { CLOTHING_TYPES, ClothingTypeSchema, ListItemsPageRequestSchema, ListItemsPageResponseSchema, ListItemsResponseSchema } from "@/lib/contracts/wardrobe";
import { requireOwner } from "@/lib/authorization";
import { getWardrobeRepository, listActiveItemsPage } from "@/lib/data/wardrobe-repository";
import { decodeItemCursor, InvalidItemCursorError } from "@/lib/data/item-cursor";
import { apiError, errorResponse, privateHeaders } from "@/lib/api";

export async function GET(request: Request) {
  try {
    await requireOwner();
    const parameters = new URL(request.url).searchParams;
    const raw = parameters.get("type");
    const parsed = raw === null ? undefined : ClothingTypeSchema.safeParse(raw);
    if (parsed && !parsed.success) return errorResponse("INVALID_REQUEST", "Unknown clothing type.", 400);
    const repository = getWardrobeRepository();
    if (parameters.has("limit") || parameters.has("cursor")) {
      const options = ListItemsPageRequestSchema.safeParse({
        type: parsed?.success ? parsed.data : undefined,
        limit: parameters.get("limit") ?? undefined,
        cursor: parameters.get("cursor") ?? undefined,
      });
      if (!options.success) return errorResponse("INVALID_REQUEST", "Use a limit from 1 to 48 and a valid cursor.", 400);
      if (options.data.cursor) decodeItemCursor(options.data.cursor, options.data.type);
      const [page, counts] = await Promise.all([listActiveItemsPage(options.data), repository.countActiveByType()]);
      const total = options.data.type ? counts[options.data.type] : CLOTHING_TYPES.reduce((sum, type) => sum + counts[type], 0);
      return NextResponse.json(ListItemsPageResponseSchema.parse({
        items: await toDeliveryItems(page.documents), nextCursor: page.nextCursor, total, counts,
      }), { headers: privateHeaders });
    }
    const [documents, counts] = await Promise.all([
      repository.listActive(parsed?.success ? parsed.data : undefined), repository.countActiveByType(),
    ]);
    const payload = { items: await toDeliveryItems(documents), total: documents.length, counts };
    return NextResponse.json(ListItemsResponseSchema.parse(payload), { headers: privateHeaders });
  } catch (error) {
    if (error instanceof InvalidItemCursorError) return errorResponse("INVALID_REQUEST", error.message, 400);
    return apiError(error);
  }
}
