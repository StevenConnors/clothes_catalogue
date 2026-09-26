import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { WardrobeDocument, ItemCounts } from "@/lib/contracts/persistence";
import { ItemIdSchema } from "@/lib/contracts/wardrobe";
import { AuthorizationError, requireOwner } from "@/lib/authorization";
import { getWardrobeRepository, toItemDTO } from "@/lib/data/wardrobe-repository";
import { BackToWardrobe, ItemActions } from "@/components/wardrobe/item-actions";
import { WardrobeHeader } from "@/components/wardrobe/wardrobe-controls";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ItemIdSchema.safeParse(id).success) notFound();
  let document: WardrobeDocument | null;
  let counts: ItemCounts;
  try {
    await requireOwner();
    const repo = await getWardrobeRepository();
    [document, counts] = await Promise.all([repo.getActiveById(id), repo.countActiveByType()]);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.status === 401) redirect("/sign-in");
      return <main className="state-page"><h1>Access denied</h1><p>This wardrobe is private to its owner.</p><Link href="/" className="text-link">Return to the wardrobe</Link></main>;
    }
    return <main className="state-page"><h1>This item couldn’t load</h1><p>Check your connection and try again.</p><Link href="/" className="text-link">Return to the wardrobe</Link></main>;
  }
  if (!document) notFound();
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return <main className="page-shell"><WardrobeHeader total={total} /><div className="detail-back"><BackToWardrobe /></div><section className="detail-layout"><ItemActions item={toItemDTO(document)} /></section></main>;
}
