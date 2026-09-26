"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CLOTHING_LABELS, ITEM_PAGE_SIZE, ListItemsPageResponseSchema, type ClothingType, type ItemDTO } from "@/lib/contracts/wardrobe";

// Adapted from ~/github/me/components/photos/PhotosGallery.tsx.
export function WardrobeGrid({ initialItems, initialCursor, type }: {
  initialItems: ItemDTO[]; initialCursor: string | null; type?: ClothingType;
}) {
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialCursor);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [failure, setFailure] = useState("");
  const [loadedMessage, setLoadedMessage] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadingRef = useRef(false);
  const completedCursorRef = useRef<string | null>(null);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingRef.current || completedCursorRef.current === nextCursor) return;
    loadingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setLoadState("loading");
    setFailure("");
    try {
      const parameters = new URLSearchParams({ limit: String(ITEM_PAGE_SIZE), cursor: nextCursor });
      if (type) parameters.set("type", type);
      const response = await fetch(`/api/items?${parameters}`, { signal: controller.signal });
      const payload = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(payload?.error?.message ?? "More items couldn’t load. Please try again.");
      const page = ListItemsPageResponseSchema.parse(payload);
      if (page.nextCursor === nextCursor) throw new Error("More items couldn’t load. Please try again.");
      completedCursorRef.current = nextCursor;
      setItems(current => {
        const known = new Set(current.map(item => item.id));
        return [...current, ...page.items.filter(item => {
          if (known.has(item.id)) return false;
          known.add(item.id);
          return true;
        })];
      });
      setNextCursor(page.nextCursor);
      setLoadedMessage(page.items.length ? `${page.items.length} more ${page.items.length === 1 ? "item" : "items"} loaded.` : "No additional items were loaded.");
      setLoadState("idle");
    } catch (error) {
      if (!controller.signal.aborted) {
        setFailure(error instanceof Error && error.name !== "ZodError" ? error.message : "More items couldn’t load. Please try again.");
        setLoadState("error");
      }
    } finally {
      loadingRef.current = false;
    }
  }, [nextCursor, type]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!nextCursor || loadState !== "idle" || !sentinelRef.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "800px 0px" });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [loadMore, nextCursor, loadState]);

  return <>
    <section className="item-grid" aria-label="Wardrobe items" aria-busy={loadState === "loading"}>
      {items.map((item, index) => <Link key={item.id} href={`/items/${item.id}`} className="item-card" aria-label={`View ${CLOTHING_LABELS[item.type]}`}>
        <div className="card-image"><Image src={`${item.images.cutout}&size=thumbnail`} alt={CLOTHING_LABELS[item.type]} width={640} height={640} unoptimized loading={index < 2 ? "eager" : "lazy"} fetchPriority={index === 0 ? "high" : "auto"} className="garment-image" /></div>
      </Link>)}
    </section>
    {nextCursor ? <div className="catalogue-loader" ref={sentinelRef}>
      {failure ? <p className="error-text" role="alert">{failure}</p> : null}
      <button className="primary-button" disabled={loadState === "loading"} onClick={() => void loadMore()} type="button">
        {loadState === "loading" ? "Loading…" : loadState === "error" ? "Try again" : "Load more"}
      </button>
    </div> : null}
    <p aria-live="polite" className="sr-only">{loadedMessage}</p>
  </>;
}
