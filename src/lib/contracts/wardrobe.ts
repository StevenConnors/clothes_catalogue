export const CLOTHING_TYPES = [
  "outer", "shirt", "tshirt", "pants", "shorts", "shoes",
] as const;

export type ClothingType = (typeof CLOTHING_TYPES)[number];

export const CLOTHING_LABELS: Record<ClothingType, string> = {
  outer: "Jacket / outer",
  shirt: "Shirt",
  tshirt: "T-shirt",
  pants: "Pants",
  shorts: "Shorts",
  shoes: "Shoes",
};

export type ImageVariant = "cutout" | "original";

export interface ItemDTO {
  id: string;                    // UUID
  type: ClothingType;
  images: {
    cutout: string;              // same-origin authenticated image endpoint
    original: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ListItemsResponse {
  items: ItemDTO[];
  total: number;                 // number matching the current filter
  counts: Record<ClothingType, number>; // all active items, before filtering
}

export interface GetItemResponse { item: ItemDTO }
export interface ListItemsPageResponse extends ListItemsResponse { nextCursor: string | null }
export const ITEM_PAGE_SIZE = 24;
export interface UpdateItemRequest { type: ClothingType }
export interface UpdateItemResponse { item: ItemDTO }

export type ErrorCode =
  | "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_REQUEST"
  | "NOT_FOUND" | "SERVICE_UNAVAILABLE" | "INTERNAL_ERROR";

export interface ErrorResponse {
  error: { code: ErrorCode; message: string };
}

import { z } from "zod";
export const ClothingTypeSchema = z.enum(CLOTHING_TYPES);
export const ImageVariantSchema = z.enum(["cutout", "original"]);
export const ItemIdSchema = z.string().uuid();
export const UpdateItemRequestSchema = z.object({ type: ClothingTypeSchema }).strict();
export const ItemDTOSchema = z.object({id: ItemIdSchema, type: ClothingTypeSchema, images: z.object({cutout:z.string().regex(/^\/api\/items\//), original:z.string().regex(/^\/api\/items\//)}).strict(), createdAt:z.string().datetime(), updatedAt:z.string().datetime()}).strict();
export const ItemCountsSchema = z.object({outer:z.number().int().nonnegative(),shirt:z.number().int().nonnegative(),tshirt:z.number().int().nonnegative(),pants:z.number().int().nonnegative(),shorts:z.number().int().nonnegative(),shoes:z.number().int().nonnegative()}).strict();
export const ListItemsResponseSchema = z.object({items:z.array(ItemDTOSchema),total:z.number().int().nonnegative(),counts:ItemCountsSchema}).strict();
export const ListItemsPageResponseSchema = ListItemsResponseSchema.extend({ nextCursor: z.string().min(1).nullable() });
export const ListItemsPageRequestSchema = z.object({
  type: ClothingTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(48).default(ITEM_PAGE_SIZE),
  cursor: z.string().min(1).max(1024).optional(),
});
export const GetItemResponseSchema = z.object({item:ItemDTOSchema}).strict();
export const UpdateItemResponseSchema = GetItemResponseSchema;
export const ErrorResponseSchema = z.object({error:z.object({code:z.enum(["UNAUTHORIZED","FORBIDDEN","INVALID_REQUEST","NOT_FOUND","SERVICE_UNAVAILABLE","INTERNAL_ERROR"]),message:z.string()}).strict()}).strict();
