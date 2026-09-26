import { NextResponse } from "next/server";
export const runtime = "nodejs";
import { ClothingTypeSchema, ListItemsResponseSchema } from "@/lib/contracts/wardrobe";
import { requireOwner } from "@/lib/authorization";
import { getWardrobeRepository, toItemDTO } from "@/lib/data/wardrobe-repository";
import { apiError, errorResponse, privateHeaders } from "@/lib/api";

export async function GET(request: Request) {
  try {
    await requireOwner();
    const raw = new URL(request.url).searchParams.get("type");
    const parsed = raw === null ? undefined : ClothingTypeSchema.safeParse(raw);
    if (parsed && !parsed.success) return errorResponse("INVALID_REQUEST", "Unknown clothing type.", 400);
    const repository = getWardrobeRepository();
    const [documents, counts] = await Promise.all([
      repository.listActive(parsed?.success ? parsed.data : undefined), repository.countActiveByType(),
    ]);
    const payload = { items: documents.map(toItemDTO), total: documents.length, counts };
    return NextResponse.json(ListItemsResponseSchema.parse(payload), { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
