import { putJson, getJson, delPath } from "./_store.js";
import { wrap, respond, fail, readJson, requireViewer, loadUser, userKeyParam, throttleUser } from "./_lib.js";

const MAX_BYTES = 60000;
const TYPES = {
  "image/png": (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP",
};

export const GET = wrap(async (request) => {
  const key = userKeyParam(new URL(request.url).searchParams.get("u"));
  const stored = await getJson(`avatars/${key}.json`);
  if (!stored) return new Response("not found", { status: 404 });
  return new Response(Buffer.from(stored.data, "base64"), {
    headers: {
      "content-type": stored.type,
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
});

export const POST = wrap(async (request) => {
  const viewer = await requireViewer(request);
  const body = await readJson(request, 100000);
  const { key, ...user } = viewer;

  if (body.remove) {
    await delPath(`avatars/${key}.json`);
    user.pfp = 0;
    await putJson(`users/${key}.json`, user);
    return respond({ pfp: 0 });
  }

  const check = TYPES[body.type];
  if (!check || typeof body.data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)) fail(400, "Use a PNG, JPEG or WebP image");
  const bytes = Buffer.from(body.data, "base64");
  if (bytes.length > MAX_BYTES) fail(413, "Image is too big");
  if (!check(bytes)) fail(400, "That doesn't look like a real image");

  await throttleUser(key, "pfp", 10000);
  await putJson(`avatars/${key}.json`, { type: body.type, data: body.data });
  user.pfp = Date.now();
  await putJson(`users/${key}.json`, user);
  return respond({ pfp: user.pfp });
});
