import { RefreshImageUrlsResponseSchema, type ItemDTO } from "../contracts/wardrobe";
type Images = ItemDTO["images"];
type Waiter = { resolve: (images: Images) => void; reject: (error: Error) => void; promise: Promise<Images> };
const pending = new Map<string, Waiter>();
const queued = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
async function flush() {
  timer = undefined;
  const ids = [...queued]; queued.clear();
  for (let index = 0; index < ids.length; index += 48) {
    const batch = ids.slice(index, index + 48);
    try {
      const response = await fetch(`/api/items/image-urls?ids=${batch.join(",")}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Image access could not be refreshed.");
      const payload = RefreshImageUrlsResponseSchema.parse(await response.json());
      for (const id of batch) {
        const item = payload.items.find(item => item.id === id);
        if (item) pending.get(id)?.resolve(item.images);
        else pending.get(id)?.reject(new Error("This item is no longer available."));
      }
    } catch { for (const id of batch) pending.get(id)?.reject(new Error("Image access could not be refreshed.")); }
    finally { for (const id of batch) pending.delete(id); }
  }
}
export function refreshImageUrls(id: string): Promise<Images> {
  const existing = pending.get(id);
  if (existing) return existing.promise;
  let resolve!: Waiter["resolve"]; let reject!: Waiter["reject"];
  const promise = new Promise<Images>((done, fail) => { resolve = done; reject = fail; });
  pending.set(id, { promise, resolve, reject }); queued.add(id);
  timer ??= setTimeout(() => void flush(), 10);
  return promise;
}

const wakeCallbacks = new Set<() => void>();
const wake = () => { for (const callback of wakeCallbacks) callback(); };
export function subscribeImageWake(callback: () => void) {
  if (!wakeCallbacks.size) { window.addEventListener("focus", wake); document.addEventListener("visibilitychange", wake); }
  wakeCallbacks.add(callback);
  return () => {
    wakeCallbacks.delete(callback);
    if (!wakeCallbacks.size) { window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); }
  };
}
