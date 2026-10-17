import { putBinary, getBinary } from "./_store.js";
import { wrap, respond, fail, readJson, requireViewer, throttleUser } from "./_lib.js";

const IMAGE_MAX = 1500000;
const VIDEO_MAX = 3000000;
export const MEDIA_RE = /^\d{13}-[a-z0-9]{6}\.(png|jpg|webp|mp4|webm)$/;

const TYPES = {
  "image/png": { ext: "png", max: IMAGE_MAX, ok: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/jpeg": { ext: "jpg", max: IMAGE_MAX, ok: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/webp": { ext: "webp", max: IMAGE_MAX, ok: (b) => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" },
  "video/mp4": { ext: "mp4", max: VIDEO_MAX, ok: (b) => b.length > 12 && b.toString("latin1", 4, 8) === "ftyp" },
  "video/webm": { ext: "webm", max: VIDEO_MAX, ok: (b) => b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
};
const MIME = Object.fromEntries(Object.values(TYPES).map((t, i) => [t.ext, Object.keys(TYPES)[i]]));

export const GET = wrap(async (request) => {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!MEDIA_RE.test(id)) return new Response("not found", { status: 404 });
  const bytes = await getBinary(`media/${id}`);
  if (!bytes) return new Response("not found", { status: 404 });
  const headers = {
    "content-type": MIME[id.split(".")[1]],
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") || "");
  if (range && (range[1] || range[2])) {
    const total = bytes.length;
    let start = range[1] ? Number(range[1]) : total - Number(range[2]);
    let end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    start = Math.max(0, start);
    if (start > end || start >= total) return new Response(null, { status: 416, headers: { "content-range": `bytes */${total}` } });
    return new Response(bytes.subarray(start, end + 1), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${total}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(bytes, { headers });
});

export const POST = wrap(async (request) => {
  const viewer = await requireViewer(request);
  const body = await readJson(request, 4200000);
  const type = TYPES[body.type];
  if (!type || typeof body.data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)) {
    fail(400, "Use a PNG, JPEG, WebP, MP4 or WebM file");
  }
  const bytes = Buffer.from(body.data, "base64");
  if (bytes.length > type.max) fail(413, type.ext === "mp4" || type.ext === "webm" ? "Videos can be up to 3 MB" : "Image is too big");
  if (!type.ok(bytes)) fail(400, "That doesn't look like a real file");
  await throttleUser(viewer.key, "media", 4000);
  const id = `${String(Date.now()).padStart(13, "0")}-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}.${type.ext}`;
  await putBinary(`media/${id}`, bytes, body.type);
  return respond({ id });
});
