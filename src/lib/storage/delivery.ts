import { issueSignedToken, presignUrl, type IssuedSignedToken } from "@vercel/blob";
import type { WardrobeDocument } from "../contracts/persistence";
import type { ItemDTO } from "../contracts/wardrobe";
import { toItemDTO } from "../data/wardrobe-repository";

export const IMAGE_URL_LIFETIME_MS = 120_000;
let signingMaterial: IssuedSignedToken | undefined;
let pending: Promise<IssuedSignedToken> | undefined;
async function getSigningMaterial() {
  if (signingMaterial && signingMaterial.validUntil > Date.now() + IMAGE_URL_LIFETIME_MS + 15_000) return signingMaterial;
  if (!pending) {
    pending = issueSignedToken({ operations: ["get"], validUntil: Date.now() + 10 * 60_000 })
      .then(token => { signingMaterial = token; return token; }).finally(() => { pending = undefined; });
  }
  return pending;
}

/** Call only after owner authorization and an active-item database query. */
export async function toDeliveryItems(documents: WardrobeDocument[]): Promise<ItemDTO[]> {
  if (!documents.length) return [];
  if (process.env.WARDROBE_IMAGE_DELIVERY === "proxy") return documents.map(toItemDTO);
  if (documents.some(document => document.deletedAt !== null)) throw new Error("Cannot sign removed images.");
  const token = await getSigningMaterial();
  const expiresAt = Math.min(Date.now() + IMAGE_URL_LIFETIME_MS, token.validUntil);
  const sign = async (pathname: string) => (await presignUrl(token, { pathname, operation: "get", access: "private", validUntil: expiresAt, useCache: true })).presignedUrl;
  return Promise.all(documents.map(async document => {
    const [cutout, original, thumbnails] = await Promise.all([
      sign(document.images.cutout.pathname), sign(document.images.original.pathname),
      Promise.all((document.images.thumbnails ?? []).map(async image => ({ url: await sign(image.pathname), width: image.width, height: image.height }))),
    ]);
    return { ...toItemDTO(document), images: { cutout, original, thumbnails, expiresAt } };
  }));
}
