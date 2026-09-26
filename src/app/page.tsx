import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CLOTHING_LABELS, CLOTHING_TYPES, ClothingTypeSchema } from "@/lib/contracts/wardrobe";
import { requireOwner, AuthorizationError } from "@/lib/authorization";
import { getWardrobeRepository, toItemDTO } from "@/lib/data/wardrobe-repository";
import { TypeFilters, WardrobeHeader } from "@/components/wardrobe/wardrobe-controls";

type PageProps = { searchParams: Promise<{ type?: string | string[] }> };

export default async function WardrobePage({ searchParams }: PageProps) {
  const query = await searchParams;
  const rawType = Array.isArray(query.type) ? query.type[0] : query.type;
  const parsedType = rawType ? ClothingTypeSchema.safeParse(rawType) : null;
  const selected = parsedType?.success ? parsedType.data : undefined;
  let documents;
  let counts;
  try {
    await requireOwner();
    const repository = await getWardrobeRepository();
    [documents, counts] = await Promise.all([repository.listActive(selected), repository.countActiveByType()]);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.status === 401) redirect("/sign-in");
      return <main className="state-page"><h1>Access denied</h1><p>This wardrobe is private to its owner.</p></main>;
    }
    return <main className="state-page"><h1>Your wardrobe couldn’t load</h1><p>Check your connection and try again.</p><Link className="primary-button" href="/">Try again</Link></main>;
  }

  const total = CLOTHING_TYPES.reduce((sum, type) => sum + counts[type], 0);
  const items = documents.map(toItemDTO).sort((a, b) =>
    CLOTHING_TYPES.indexOf(a.type) - CLOTHING_TYPES.indexOf(b.type)
  );
  return <main className="page-shell">
    <WardrobeHeader total={total} />
    <section className="catalogue-heading"><div><p className="eyebrow">YOUR COLLECTION</p><h1>Wardrobe</h1></div></section>
    <TypeFilters selected={selected} counts={counts} total={total} />
    {items.length === 0 ? <section className="empty-state"><div className="empty-mark">W</div><h2>{total === 0 ? "Your wardrobe is ready" : "No items in this category"}</h2><p>{total === 0 ? "Your catalogue will appear here once your first batch is imported." : "Try another clothing type to see more of your wardrobe."}</p>{total > 0 && <Link className="text-link" href="/">View all items</Link>}</section> :
      <section className="item-grid" aria-label="Wardrobe items">{items.map(item => <Link key={item.id} href={`/items/${item.id}`} className="item-card" aria-label={`View ${CLOTHING_LABELS[item.type]}`}>
        <div className="card-image"><Image src={item.images.cutout} alt={CLOTHING_LABELS[item.type]} width={600} height={600} unoptimized loading="lazy" className="garment-image" /></div>
      </Link>)}</section>}
  </main>;
}
