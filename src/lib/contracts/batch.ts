import type { ClothingType } from "./wardrobe";
export type ReviewStatus = "pending" | "approved" | "rejected";

export interface BatchEntry {
  sourcePath: string;            // relative to incoming/<batchId>/
  sourceSha256: string;
  type: ClothingType | null;
  cutoutPath: string | null;     // relative to processed/<batchId>/
  cutoutSha256: string | null;   // digest of the output file reviewed by the owner
  model: "birefnet-general";
  warnings: string[];
  reviewStatus: ReviewStatus;
}

export interface BatchManifest {
  schemaVersion: 1;
  batchId: string;
  entries: BatchEntry[];
}

export interface ImportReport {
  batchId: string;
  imported: { sourceSha256: string; itemId: string }[];
  skipped: {
    sourceSha256: string;
    reason: "not_approved" | "already_exists" | "previously_removed";
    itemId?: string;
  }[];
  failed: { sourceSha256: string; message: string }[];
}

import { z } from "zod";
import { ClothingTypeSchema } from "./wardrobe";
export const BatchIdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const ReviewStatusSchema = z.enum(["pending","approved","rejected"]);
export const BatchEntrySchema = z.object({sourcePath:z.string().min(1),sourceSha256:Sha256Schema,type:ClothingTypeSchema.nullable(),cutoutPath:z.string().min(1).nullable(),cutoutSha256:Sha256Schema.nullable(),model:z.literal("birefnet-general"),warnings:z.array(z.string()),reviewStatus:ReviewStatusSchema}).strict();
export const BatchManifestSchema = z.object({schemaVersion:z.literal(1),batchId:BatchIdSchema,entries:z.array(BatchEntrySchema)}).strict();
export const ImportReportSchema = z.object({batchId:BatchIdSchema,imported:z.array(z.object({sourceSha256:Sha256Schema,itemId:z.string().uuid()}).strict()),skipped:z.array(z.object({sourceSha256:Sha256Schema,reason:z.enum(["not_approved","already_exists","previously_removed"]),itemId:z.string().uuid().optional()}).strict()),failed:z.array(z.object({sourceSha256:Sha256Schema,message:z.string()}).strict())}).strict();
