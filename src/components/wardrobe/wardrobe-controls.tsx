import Link from "next/link";
import { CLOTHING_LABELS, CLOTHING_TYPES, type ClothingType } from "@/lib/contracts/wardrobe";
import { signOut } from "@/lib/auth";

export function WardrobeHeader({ total }: { total: number }) {
  return <header className="site-header"><Link className="wordmark" href="/">Wardrobe</Link><div className="header-meta"><span>{total} {total === 1 ? "item" : "items"}</span><form action={async () => { "use server"; await signOut({ redirectTo: "/sign-in" }); }}><button className="signout" type="submit">Sign out</button></form></div></header>;
}

export function TypeFilters({ selected, counts, total }: { selected?: ClothingType; counts: Record<ClothingType, number>; total: number }) {
  return <nav className="filters" aria-label="Filter by clothing type">
    <Link className={`filter ${selected ? "" : "selected"}`} href="/">All <span>{total}</span></Link>
    {CLOTHING_TYPES.map(type => <Link key={type} className={`filter ${selected === type ? "selected" : ""}`} href={`/?type=${type}`}>{CLOTHING_LABELS[type]} <span>{counts[type]}</span></Link>)}
  </nav>;
}

export function ClothingLabel({ type }: { type: ClothingType }) { return <span className="type-label">{CLOTHING_LABELS[type]}</span>; }
