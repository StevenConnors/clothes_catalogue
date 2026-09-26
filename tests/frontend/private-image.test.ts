// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrivateImage } from "@/components/wardrobe/private-image";
import type { ItemDTO } from "@/lib/contracts/wardrobe";
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/lib/client/image-urls", () => ({ refreshImageUrls: refresh, subscribeImageWake: (check: () => void) => { window.addEventListener("focus", check); return () => window.removeEventListener("focus", check); } }));
vi.mock("next/image", () => ({ default: ({ unoptimized, loader, ...props }: ComponentProps<"img"> & { unoptimized?: boolean; loader?: (input: { width: number }) => string }) =>
  createElement("img", { ...props, src: loader ? loader({ width: 640 }) : props.src, srcSet: !unoptimized && loader ? [320,480,640].map(width => `${loader({width})} ${width}w`).join(", ") : undefined }) }));
let root: Root;
const item = (): ItemDTO => ({ id: "00000000-0000-4000-8000-000000000001", type: "shirt", images: {
  cutout: "https://store.private.blob.vercel-storage.com/cutout?token=old", original: "https://store.private.blob.vercel-storage.com/original?token=old",
  thumbnails: [320,480,640].map(width => ({ width, height: width, url: `https://store.private.blob.vercel-storage.com/thumb-${width}?token=old` })), expiresAt: Date.now() + 120_000,
}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("IntersectionObserver", undefined); document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById("root")!); });
afterEach(async () => { await act(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
const render = async (value: ItemDTO) => act(() => root.render(createElement(PrivateImage, { item: value, alt: "Shirt", thumbnail: true, eager: true })));
it("uses stored responsive URLs without modifying signatures or proxying", async () => {
  await render(item()); const image = document.querySelector("img")!;
  expect(image.srcset).toContain("thumb-320?token=old 320w"); expect(image.srcset).toContain("thumb-640?token=old 640w");
  expect(image.src).not.toContain("/api/"); expect(image.src).not.toContain("/_next/image"); expect(refresh).not.toHaveBeenCalled();
});
it("refreshes an unloaded image before expiry, but leaves loaded images untouched", async () => {
  const value = item(); refresh.mockResolvedValue({ ...value.images, expiresAt: Date.now() + 300_000 });
  await render(value); await act(() => vi.advanceTimersByTimeAsync(105_001)); expect(refresh).toHaveBeenCalledTimes(1);
  await act(() => document.querySelector("img")!.dispatchEvent(new Event("load")));
  await act(() => vi.advanceTimersByTimeAsync(300_000)); expect(refresh).toHaveBeenCalledTimes(1);
});
it("bounds error retries and offers a manual retry after another failure", async () => {
  const value = item(); refresh.mockResolvedValue({ ...value.images, cutout: value.images.cutout + "x", thumbnails: value.images.thumbnails!.map(image => ({ ...image, url: image.url + "x" })) });
  await act(() => root.render(createElement(PrivateImage, { item: value, alt: "Shirt", eager: true }))); await act(() => document.querySelector("img")!.dispatchEvent(new Event("error"))); expect(refresh).toHaveBeenCalledTimes(1);
  await act(() => document.querySelector("img")!.dispatchEvent(new Event("error"))); expect(refresh).toHaveBeenCalledTimes(1);
  expect(document.querySelector("button")!.textContent).toBe("Retry image");
  await act(() => document.querySelector("button")!.click()); expect(refresh).toHaveBeenCalledTimes(2); expect(document.querySelector("img")).not.toBeNull();
});
it("refreshes delayed images when returning to the tab", async () => {
  const value = item(); refresh.mockResolvedValue({ ...value.images, expiresAt: Date.now() + 600_000 });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden"); await render(value);
  await act(() => vi.advanceTimersByTimeAsync(130_000)); expect(refresh).not.toHaveBeenCalled();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible"); await act(() => window.dispatchEvent(new Event("focus"))); expect(refresh).toHaveBeenCalledTimes(1); vi.restoreAllMocks();
});
