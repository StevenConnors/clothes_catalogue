import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMock, putMock } = vi.hoisted(() => ({ getMock: vi.fn(), putMock: vi.fn() }));
vi.mock("@vercel/blob", () => ({ get: getMock, put: putMock, BlobNotFoundError: class BlobNotFoundError extends Error {} }));
import { getImageStore } from "@/lib/storage/blob";

const stream = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
const bytes = Buffer.from("private image bytes");

beforeEach(() => vi.resetAllMocks());

describe("private immutable Blob adapter", () => {
  it("uses the private CDN cache for immutable image reads", async () => {
    getMock.mockResolvedValue({ statusCode: 200, stream: stream(bytes), blob: { contentType: "image/png" } });
    const result = await getImageStore().readPrivate({ pathname: "wardrobe/cutout", contentType: "image/png" });
    expect(result?.contentType).toBe("image/png");
    expect(getMock).toHaveBeenCalledWith("wardrobe/cutout", { access: "private", useCache: true });
  });
  it("reuses a byte-identical private object without uploading", async () => {
    getMock.mockResolvedValue({ statusCode: 200, stream: stream(bytes), blob: { pathname: "wardrobe/original", contentType: "image/jpeg" } });
    const result = await getImageStore().putPrivate("wardrobe/original", bytes, "image/jpeg");
    expect(result).toEqual({ pathname: "wardrobe/original", contentType: "image/jpeg" });
    expect(putMock).not.toHaveBeenCalled();
  });

  it("rejects a pathname collision when the existing bytes differ", async () => {
    getMock.mockResolvedValue({ statusCode: 200, stream: stream(Buffer.from("different")), blob: { pathname: "wardrobe/original", contentType: "image/jpeg" } });
    await expect(getImageStore().putPrivate("wardrobe/original", bytes, "image/jpeg")).rejects.toThrow(/different content/);
    expect(putMock).not.toHaveBeenCalled();
  });

  it("treats BlobNotFoundError from the initial lookup as an absent object", async () => {
    const NotFound = (await import("@vercel/blob")).BlobNotFoundError;
    getMock.mockRejectedValueOnce(new NotFound()).mockResolvedValueOnce(null);
    putMock.mockResolvedValue({ pathname: "wardrobe/new" });
    const result = await getImageStore().putPrivate("wardrobe/new", bytes, "image/jpeg");
    expect(result.pathname).toBe("wardrobe/new");
    expect(putMock).toHaveBeenCalledTimes(1);
  });

  it("reuses matching bytes after a concurrent immutable upload wins", async () => {
    getMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ statusCode: 200, stream: stream(bytes), blob: { pathname: "wardrobe/raced", contentType: "image/jpeg" } });
    putMock.mockRejectedValueOnce(new Error("pathname already exists"));
    const result = await getImageStore().putPrivate("wardrobe/raced", bytes, "image/jpeg");
    expect(result.pathname).toBe("wardrobe/raced");
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(putMock).toHaveBeenCalledTimes(1);
  });

  it("uploads only when no stored object exists, with private immutable options", async () => {
    getMock.mockResolvedValue(null);
    putMock.mockResolvedValue({ pathname: "wardrobe/new" });
    const result = await getImageStore().putPrivate("wardrobe/new", bytes, "image/jpeg");
    expect(result.pathname).toBe("wardrobe/new");
    expect(putMock).toHaveBeenCalledWith("wardrobe/new", expect.any(Buffer), expect.objectContaining({ access: "private", allowOverwrite: false, addRandomSuffix: false }));
  });
});
