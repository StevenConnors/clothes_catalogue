"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { ImageVariant, ItemDTO } from "@/lib/contracts/wardrobe";
import { refreshImageUrls, subscribeImageWake } from "@/lib/client/image-urls";

export function PrivateImage({ item, alt, thumbnail = false, eager = false, highPriority = false, variant = "cutout" }: {
  item: ItemDTO; alt: string; thumbnail?: boolean; eager?: boolean; highPriority?: boolean; variant?: ImageVariant;
}) {
  const [lease, setLease] = useState<{ base: ItemDTO["images"]; images: ItemDTO["images"] }>();
  const [failed, setFailed] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const attempts = useRef(0);
  const mounted = useRef(false);
  const images = lease?.base === item.images ? lease.images : item.images;
  useEffect(() => {
    mounted.current = true;
    let active = true;
    let near = eager || !thumbnail;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const images = await refreshImageUrls(item.id);
        if (active) setLease({ base: item.images, images });
      } catch { if (active) setFailed(true); }
      finally { busy = false; }
    };
    const check = () => {
      if (!loaded.current && near && images.expiresAt && images.expiresAt <= Date.now() + 15_000 && document.visibilityState !== "hidden") void refresh();
    };
    const observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(entries => {
      near = entries.some(entry => entry.isIntersecting); check();
    }, { rootMargin: "800px 0px" }) : undefined;
    if (container.current) observer?.observe(container.current);
    if (!observer) near = true;
    check();
    const timer = images.expiresAt ? setTimeout(check, Math.max(0, images.expiresAt - Date.now() - 15_000)) : undefined;
    const unsubscribe = subscribeImageWake(check);
    return () => { active = false; mounted.current = false; observer?.disconnect(); clearTimeout(timer); unsubscribe(); };
  }, [item.id, item.images, images, eager, thumbnail]);
  async function retry() {
    try {
      const images = await refreshImageUrls(item.id);
      if (mounted.current) { loaded.current = false; setLease({ base: item.images, images }); setFailed(false); }
    } catch { if (mounted.current) setFailed(true); }
  }
  const variants = images.thumbnails ?? [];
  const src = thumbnail ? variants.at(-1)?.url ?? (images.expiresAt ? images.cutout : `${images.cutout}&size=thumbnail`) : images[variant];
  return <div ref={container} style={{ width: "100%", height: "100%" }}>
    {failed ? <div className="image-error" role="status"><p>This photo couldn’t be loaded.</p>{thumbnail ? <p>Open this item to try again.</p> : <button className="retry" type="button" onClick={() => void retry()}>Retry image</button>}</div> :
      <Image key={src} src={thumbnail && variants.length ? `/wardrobe-thumbnail/${item.id}` : src} alt={alt} width={thumbnail ? 640 : 1000} height={thumbnail ? 640 : 1000}
        unoptimized={!thumbnail || !variants.length}
        loader={thumbnail && variants.length ? ({ width }) => (variants.find(image => image.width >= width) ?? variants.at(-1))!.url : undefined}
        sizes={thumbnail ? "(max-width: 599px) 50vw, (max-width: 899px) 33vw, (max-width: 1249px) 25vw, 288px" : undefined}
        loading={eager ? "eager" : "lazy"} fetchPriority={highPriority ? "high" : "auto"} className="garment-image"
        onLoad={() => { loaded.current = true; attempts.current = 0; }}
        onError={() => { if (images.expiresAt && attempts.current++ === 0) void retry(); else setFailed(true); }} />}
  </div>;
}
