import { NextResponse } from "next/server";
import { BlobError } from "@vercel/blob";
import { AuthorizationError } from "@/lib/authorization";
import type { ErrorCode } from "@/lib/contracts/wardrobe";

export const privateHeaders = { "Cache-Control": "private, no-store" };
export function errorResponse(code: ErrorCode, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: privateHeaders });
}
export function apiError(error: unknown) {
  if (error instanceof AuthorizationError) return errorResponse(error.code, error.message, error.status);
  const name = error instanceof Error ? error.name : "";
  const unavailable = error instanceof BlobError || name === "ServiceUnavailableError" ||
    ["MongoServerSelectionError", "MongoNetworkError", "MongoTopologyClosedError"].includes(name);
  console.error("Wardrobe API operation failed", error);
  return unavailable
    ? errorResponse("SERVICE_UNAVAILABLE", "The wardrobe service is temporarily unavailable.", 503)
    : errorResponse("INTERNAL_ERROR", "An unexpected error occurred.", 500);
}
export function validMutationOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const configured = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  try {
    return new URL(origin).origin === new URL(configured || request.url).origin;
  } catch {
    return false;
  }
}
