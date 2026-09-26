// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WardrobeGrid } from "@/components/wardrobe/wardrobe-grid";
import type { ItemDTO } from "@/lib/contracts/wardrobe";

vi.mock("@/components/wardrobe/private-image", () => ({ PrivateImage: ({ alt }: { alt: string }) => createElement("img", { alt }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children) }));
vi.mock("next/image", () => ({ default: (props: ComponentProps<"img"> & { unoptimized?: boolean }) => {
  const imageProps = { ...props };
  delete imageProps.unoptimized;
  return createElement("img", imageProps);
} }));

const item = (index: number): ItemDTO => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, type: "shirt",
  images: { cutout: `/api/items/${index}/image?variant=cutout`, original: `/api/items/${index}/image?variant=original` },
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});
const response = (items: ItemDTO[], nextCursor: string | null = null) => ({
  ok: true, json: async () => ({ items, nextCursor, total: 3, counts: { outer: 0, shirt: 3, tshirt: 0, pants: 0, shorts: 0, shoes: 0 } }),
});
let root: Root;
let observers: { callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn>; options?: IntersectionObserverInit }[];
const cards = () => [...document.querySelectorAll(".item-card")].map(card => card.getAttribute("href"));
const click = async () => act(() => { document.querySelector("button")!.click(); });
const intersect = async () => act(() => { observers.at(-1)!.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); });
async function renderGrid(props: Partial<ComponentProps<typeof WardrobeGrid>> = {}, key = "all") {
  await act(() => root.render(createElement(WardrobeGrid, { initialItems: [item(1)], initialCursor: "cursor-one", ...props, key })));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  observers = [];
  vi.stubGlobal("IntersectionObserver", class {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { observers.push({ callback, options, disconnect: this.disconnect }); }
  });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => { await act(() => root.unmount()); vi.unstubAllGlobals(); });

describe("WardrobeGrid infinite scroll", () => {
  it("keeps the server page, automatically appends unique items, and stops at the end", async () => {
    const fetchMock = vi.fn(async () => response([item(1), item(2), item(2)]));
    vi.stubGlobal("fetch", fetchMock);
    await renderGrid({ type: "shirt" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(observers[0].options).toMatchObject({ rootMargin: "800px 0px" });
    await intersect();
    expect(fetchMock).toHaveBeenCalledWith("/api/items?limit=24&cursor=cursor-one&type=shirt", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(cards()).toEqual([`/items/${item(1).id}`, `/items/${item(2).id}`]);
    expect(document.querySelector("button")).toBeNull();
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it("prevents concurrent requests from rapid observer callbacks and button clicks", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    const fetchMock = vi.fn<(url: string, options: RequestInit) => Promise<ReturnType<typeof response>>>().mockImplementation(() => new Promise(done => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    await renderGrid();
    await intersect();
    await intersect();
    await click();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector("button")!.disabled).toBe(true);
    await act(async () => resolve(response([item(2)], "cursor-two")));
    await intersect();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=cursor-two");
    await act(async () => resolve(response([item(3)])));
    expect(cards()).toHaveLength(3);
  });

  it("preserves existing cards on failure, stops automatic retries, and retries manually", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: "Offline" } }) }).mockResolvedValueOnce(response([item(2)]));
    vi.stubGlobal("fetch", fetchMock);
    await renderGrid();
    await intersect();
    expect(cards()).toHaveLength(1);
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("Offline");
    expect(document.querySelector("button")!.textContent).toContain("Try again");
    expect(observers).toHaveLength(1);
    expect(observers[0].disconnect).toHaveBeenCalled();
    await click();
    expect(cards()).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("supports manual loading when IntersectionObserver is unavailable", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal("fetch", vi.fn(async () => response([item(2)])));
    await renderGrid();
    await click();
    expect(cards()).toHaveLength(2);
  });

  it("aborts a pending request when filters change and ignores its late response", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    const fetchMock = vi.fn<(url: string, options: RequestInit) => Promise<ReturnType<typeof response>>>().mockImplementation(() => new Promise(done => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    await renderGrid();
    await intersect();
    const signal = fetchMock.mock.calls[0][1].signal!;
    await renderGrid({ initialItems: [item(3)], initialCursor: null, type: "shirt" }, "shirt");
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(response([item(2)])));
    expect(cards()).toEqual([`/items/${item(3).id}`]);
    expect(document.querySelector("button")).toBeNull();
  });

  it.each(["malformed", "repeated cursor"])("offers retry for a %s response instead of looping", async failure => {
    vi.stubGlobal("fetch", vi.fn(async () => failure === "malformed" ? { ok: true, json: async () => ({ items: [] }) } : response([item(2)], "cursor-one")));
    await renderGrid();
    await intersect();
    expect(cards()).toHaveLength(1);
    expect(document.querySelector("button")!.textContent).toContain("Try again");
    expect(observers).toHaveLength(1);
  });
});
