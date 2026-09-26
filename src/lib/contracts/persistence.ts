import type { ClothingType } from "./wardrobe";
export interface StoredImage {
  pathname: string;
  contentType: "image/jpeg" | "image/png";
}

export interface WardrobeDocument {
  _id: string;                   // UUID, exposed as ItemDTO.id
  sourceSha256: string;          // SHA-256 of unchanged source-file bytes
  type: ClothingType;
  images: { original: StoredImage; cutout: StoredImage };
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type ItemCounts = Record<ClothingType, number>;

export interface WardrobeRepository {
  listActive(type?: ClothingType): Promise<WardrobeDocument[]>;
  countActiveByType(): Promise<ItemCounts>;
  getActiveById(id: string): Promise<WardrobeDocument | null>;
  findBySourceHash(hash: string): Promise<WardrobeDocument | null>;
  insertIfAbsent(document: WardrobeDocument): Promise<{
    inserted: boolean;
    document: WardrobeDocument;
  }>;
  updateType(id: string, type: ClothingType): Promise<WardrobeDocument | null>;
  softDelete(id: string): Promise<boolean>; // true if ID exists, even already hidden
}

export interface ImageStore {
  putPrivate(pathname: string, bytes: Uint8Array,
    contentType: StoredImage["contentType"]): Promise<StoredImage>;
  readPrivate(image: StoredImage): Promise<{
    body: ReadableStream<Uint8Array>;
    contentType: string;
  } | null>;
}
