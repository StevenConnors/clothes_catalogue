import { NextResponse } from "next/server";
export const runtime = "nodejs";
import { ImageVariantSchema, ItemIdSchema } from "@/lib/contracts/wardrobe";
import { requireOwner } from "@/lib/authorization";
import { getWardrobeRepository } from "@/lib/data/wardrobe-repository";
import { getImageStore } from "@/lib/storage/blob";
import { apiError, errorResponse, privateHeaders } from "@/lib/api";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    await requireOwner();
    const { id } = await context.params;
    if (!ItemIdSchema.safeParse(id).success) return errorResponse("INVALID_REQUEST", "Invalid item ID.", 400);
    const variant = ImageVariantSchema.safeParse(new URL(request.url).searchParams.get("variant"));
    if (!variant.success) return errorResponse("INVALID_REQUEST", "Invalid image variant.", 400);
    const item = await getWardrobeRepository().getActiveById(id);
    if (!item) return errorResponse("NOT_FOUND", "Item not found.", 404);
    const image = item.images[variant.data];
    const found = await getImageStore().readPrivate(image);
    if (!found) return errorResponse("NOT_FOUND", "Image not found.", 404);
    return new NextResponse(found.body, {
      status: 200,
      headers: { ...privateHeaders, "Content-Type": found.contentType, "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) { return apiError(error); }
}
