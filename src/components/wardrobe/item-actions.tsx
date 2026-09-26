"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CLOTHING_LABELS, CLOTHING_TYPES, type ClothingType, type ItemDTO, type ImageVariant } from "@/lib/contracts/wardrobe";

export function ItemActions({ item }: { item: ItemDTO }) {
  const router = useRouter();
  const [variant, setVariant] = useState<ImageVariant>("cutout");
  const [type, setType] = useState(item.type);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [retryType, setRetryType] = useState<ClothingType | null>(null);
  const [removing, setRemoving] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);

  async function changeType(next: ClothingType) {
    setSaved(false); setError(""); setRetryType(next); setSaving(true);
    try {
      const response = await fetch(`/api/items/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: next }) });
      if (!response.ok) throw new Error("We couldn’t save that change. Please try again.");
      setType(next); setRetryType(null); setSaved(true); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "We couldn’t save that change. Please try again."); }
    finally { setSaving(false); }
  }

  async function removeItem() {
    if (!window.confirm("Hide this item from your catalogue? Its stored photos will be kept.")) return;
    setRemoving(true); setError("");
    try {
      const response = await fetch(`/api/items/${item.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("We couldn’t remove this item. Please try again.");
      router.push("/"); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "We couldn’t remove this item. Please try again."); setRemoving(false); }
  }

  return <>
    <div className="detail-photo">{imageFailed ? <div className="image-error" role="status"><p>This photo couldn’t be loaded.</p><button className="retry" type="button" onClick={() => { setImageFailed(false); setImageAttempt(value => value + 1); }}>Retry image</button></div> : <Image key={`${variant}-${imageAttempt}`} src={item.images[variant]} alt={`${CLOTHING_LABELS[type]}${variant === "original" ? " original photo" : " cutout"}`} width={1000} height={1000} unoptimized priority className="garment-image" onError={() => setImageFailed(true)} />}</div>
    <div className="detail-tools">
      <div className="toggle" role="group" aria-label="Photo view">{(["cutout", "original"] as const).map(v => <button key={v} type="button" aria-pressed={variant === v} className={variant === v ? "active" : ""} onClick={() => { setVariant(v); setImageFailed(false); }}>{v === "cutout" ? "Cutout" : "Original photo"}</button>)}</div>
      <label className="field-label" htmlFor="item-type">Clothing type</label>
      <select id="item-type" value={type} disabled={saving || removing} onChange={event => void changeType(event.target.value as ClothingType)}>{CLOTHING_TYPES.map(v => <option key={v} value={v}>{CLOTHING_LABELS[v]}</option>)}</select>
      <div className="save-status" aria-live="polite">{saving ? "Saving…" : saved ? "Saved" : error ? <span className="error-text">{error} <button type="button" className="retry" onClick={() => retryType && void changeType(retryType)}>Retry</button></span> : " "}</div>
      <button className="remove-button" type="button" disabled={removing} onClick={() => void removeItem()}>{removing ? "Removing…" : "Remove from catalogue"}</button>
    </div>
  </>;
}

export function BackToWardrobe() { return <Link className="back-link" href="/">← Wardrobe</Link>; }
