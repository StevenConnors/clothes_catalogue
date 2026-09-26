import Link from "next/link";

export default function NotFound() {
  return <main className="state-page"><p className="eyebrow">NOT FOUND</p><h1>This item isn’t available</h1><p>It may have been removed from your catalogue.</p><Link className="text-link" href="/">Return to the wardrobe</Link></main>;
}
