import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

// Extract only catalogue image timings and selected response headers. No cookies,
// resource content, screenshots, private item IDs, or extension data in output.
// node scripts/analyze-image-trace.mjs <trace.json[.gz]> <output.json>
const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Provide an input trace and output JSON path.");
const input = await readFile(inputPath);
const trace = JSON.parse((inputPath.endsWith(".gz") ? gunzipSync(input) : input).toString());
const requests = new Map();
for (const event of trace.traceEvents) {
  const data = event.args?.data;
  if (!data?.requestId) continue;
  if (!["ResourceSendRequest", "ResourceReceiveResponse", "ResourceFinish"].includes(event.name)) continue;
  const record = requests.get(data.requestId) ?? {};
  record[event.name] = event;
  requests.set(data.requestId, record);
}
const rows = [];
for (const record of requests.values()) {
  const sent = record.ResourceSendRequest?.args.data;
  const response = record.ResourceReceiveResponse?.args.data;
  const finished = record.ResourceFinish?.args.data;
  if (!sent || !response || !finished) continue;
  const url = new URL(sent.url);
  if (url.hostname !== "www.stuff.yujitanaka.com" || !url.pathname.endsWith("/image")) continue;
  const timing = response.timing;
  const headers = Object.fromEntries(response.headers.map(header => [header.name.toLowerCase(), header.value]));
  rows.push({
    sample: rows.length + 1,
    variant: url.searchParams.get("variant"), size: url.searchParams.get("size"),
    status: response.statusCode, mimeType: response.mimeType, protocol: response.protocol,
    fromBrowserCache: response.fromCache, connectionReused: response.connectionReused,
    encodedBytes: finished.encodedDataLength, bodyBytes: finished.decodedBodyLength,
    waitMs: Number((timing.receiveHeadersStart - timing.sendStart).toFixed(2)),
    downloadMs: Number((finished.finishTime * 1000 - (timing.requestTime * 1000 + timing.receiveHeadersEnd)).toFixed(2)),
    headers: {
      cacheControl: headers["cache-control"], etag: headers.etag ?? null,
      vercelCache: headers["x-vercel-cache"], regionRoute: headers["x-vercel-id"]?.split("::").slice(0, 2).join("::"),
      serverTiming: headers["server-timing"] ?? null,
    },
  });
}
const result = { recordedAt: trace.metadata?.startTime, method: "DevTools trace network timing; only requests completed inside the recording are included. Browser Resource Timing may cover additional later requests.", rows };
await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
