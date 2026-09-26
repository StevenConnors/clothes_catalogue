// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("batches simultaneous image refreshes and deduplicates the same item", async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ items: [1,2].map(index => ({ id: id(index), images: { cutout: `/api/items/${id(index)}/image?variant=cutout`, original: `/api/items/${id(index)}/image?variant=original` } })) }) }));
  vi.stubGlobal("fetch", fetch); const { refreshImageUrls } = await import("@/lib/client/image-urls");
  const first = refreshImageUrls(id(1)); expect(refreshImageUrls(id(1))).toBe(first); const second = refreshImageUrls(id(2));
  await vi.advanceTimersByTimeAsync(11); await Promise.all([first,second]); expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]).toEqual([`/api/items/image-urls?ids=${id(1)},${id(2)}`, { credentials: "same-origin", cache: "no-store" }]);
});
it("rejects missing/removed images and can retry after an unsuccessful refresh", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }); vi.stubGlobal("fetch", fetch);
  const { refreshImageUrls } = await import("@/lib/client/image-urls");
  const first = expect(refreshImageUrls(id(1))).rejects.toThrow("no longer available"); await vi.advanceTimersByTimeAsync(11); await first;
  fetch.mockResolvedValue({ ok: false }); const second = expect(refreshImageUrls(id(1))).rejects.toThrow("could not be refreshed"); await vi.advanceTimersByTimeAsync(11); await second; expect(fetch).toHaveBeenCalledTimes(2);
});
