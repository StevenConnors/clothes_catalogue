import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/authorization";
import { apiError, errorResponse, privateHeaders } from "@/lib/api";
import { RefreshImageUrlsRequestSchema, RefreshImageUrlsResponseSchema } from "@/lib/contracts/wardrobe";
import { getActiveItemsByIds } from "@/lib/data/wardrobe-repository";
import { toDeliveryItems } from "@/lib/storage/delivery";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await requireOwner();
    const raw = new URL(request.url).searchParams.get("ids") ?? "";
    if (raw.length > 1800) return errorResponse("INVALID_REQUEST", "Request at most 48 item IDs.", 400);
    const input = RefreshImageUrlsRequestSchema.safeParse({ ids: raw.split(",") });
    if (!input.success) return errorResponse("INVALID_REQUEST", "Request 1 to 48 valid item IDs.", 400);
    const items = await toDeliveryItems(await getActiveItemsByIds([...new Set(input.data.ids)]));
    return NextResponse.json(RefreshImageUrlsResponseSchema.parse({ items: items.map(({ id, images }) => ({ id, images })) }), { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
