import { toDeliveryItems } from "@/lib/storage/delivery";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
import { ItemIdSchema, UpdateItemRequestSchema, UpdateItemResponseSchema, GetItemResponseSchema } from "@/lib/contracts/wardrobe";
import { requireOwner } from "@/lib/authorization";
import { getWardrobeRepository } from "@/lib/data/wardrobe-repository";
import { apiError, errorResponse, privateHeaders, validMutationOrigin } from "@/lib/api";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    await requireOwner();
    const { id } = await context.params;
    if (!ItemIdSchema.safeParse(id).success) return errorResponse("INVALID_REQUEST", "Invalid item ID.", 400);
    const item = await getWardrobeRepository().getActiveById(id);
    if (!item) return errorResponse("NOT_FOUND", "Item not found.", 404);
    return NextResponse.json(GetItemResponseSchema.parse({ item: (await toDeliveryItems([item]))[0] }), { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    await requireOwner();
    if (!validMutationOrigin(request)) return errorResponse("FORBIDDEN", "Cross-origin requests are not allowed.", 403);
    const { id } = await context.params;
    if (!ItemIdSchema.safeParse(id).success) return errorResponse("INVALID_REQUEST", "Invalid item ID.", 400);
    let body: unknown;
    try { body = await request.json(); } catch { return errorResponse("INVALID_REQUEST", "Expected a JSON request body.", 400); }
    const input = UpdateItemRequestSchema.safeParse(body);
    if (!input.success) return errorResponse("INVALID_REQUEST", "Expected exactly one valid clothing type.", 400);
    const item = await getWardrobeRepository().updateType(id, input.data.type);
    if (!item) return errorResponse("NOT_FOUND", "Item not found.", 404);
    return NextResponse.json(UpdateItemResponseSchema.parse({ item: (await toDeliveryItems([item]))[0] }), { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    await requireOwner();
    if (!validMutationOrigin(request)) return errorResponse("FORBIDDEN", "Cross-origin requests are not allowed.", 403);
    const { id } = await context.params;
    if (!ItemIdSchema.safeParse(id).success) return errorResponse("INVALID_REQUEST", "Invalid item ID.", 400);
    if (!(await getWardrobeRepository().softDelete(id))) return errorResponse("NOT_FOUND", "Item not found.", 404);
    return new Response(null, { status: 204, headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
