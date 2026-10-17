import { listBlobs, getJson, putJson } from "./_store.js";
import { createHash } from "node:crypto";
import { getViewer, loadUser, keyOf, USER_RE } from "./_lib.js";

// Only these thread names are accepted, so nobody can create random threads.
const THREAD_RE = /^(chat|home|about|lore-[a-z0-9-]{1,30}|art-\d{1,3}|char-[a-z0-9-]{1,30}|user-[a-z0-9_-]{3,20})$/;

const MAX_NAME = 24;
const MAX_TEXT = 500;
const MAX_BODY = 4000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const COOLDOWN_MS = 8000;

const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

function respond(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// One blob per message, so two people posting at once never overwrite each other.
async function listPaths(thread) {
  return (await listBlobs(`comments/${thread}/`)).map((b) => b.pathname);
}

async function readMessage(pathname) {
  return getJson(pathname);
}

async function recentMessages(thread, limit) {
  const paths = (await listPaths(thread)).slice(-limit);
  const messages = await Promise.all(paths.map((path) => readMessage(path).catch(() => null)));
  return messages.filter(Boolean);
}

function publicView({ name, text, ts, user, color }) {
  return user ? { name, text, ts, user, color } : { name, text, ts };
}

function clientHash(request) {
  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  return createHash("sha256")
    .update(ip + (process.env.COMMENT_SALT || "sanguine"))
    .digest("hex")
    .slice(0, 24);
}

function threadFrom(request) {
  const thread = new URL(request.url).searchParams.get("thread") || "";
  return THREAD_RE.test(thread) ? thread : null;
}

export async function GET(request) {
  const thread = threadFrom(request);
  if (!thread) return respond({ error: "Unknown thread" }, 400);

  const asked = parseInt(new URL(request.url).searchParams.get("limit"), 10);
  const limit = Math.min(Number.isFinite(asked) && asked > 0 ? asked : DEFAULT_LIMIT, MAX_LIMIT);

  try {
    const messages = await recentMessages(thread, limit);
    return respond({ messages: messages.map(publicView) });
  } catch (error) {
    console.error(error);
    return respond({ error: "Could not load messages" }, 500);
  }
}

export async function POST(request) {
  const thread = threadFrom(request);
  if (!thread) return respond({ error: "Unknown thread" }, 400);

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return respond({ error: "Too long" }, 413);
    body = JSON.parse(raw);
  } catch {
    return respond({ error: "Bad request" }, 400);
  }

  // Hidden form field that real people never fill in; bots do.
  if (body.website) return respond({ ok: true });

  let viewer = null;
  let name;
  try {
    viewer = await getViewer(request);
    name =
      String(body.name || "")
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, MAX_NAME) || "anonymous";
    // Registered names can only be used by their owner.
    if (viewer) name = viewer.name;
    else if (USER_RE.test(name) && (await loadUser(keyOf(name)))) {
      return respond({ error: "That name is registered, sign in to use it" }, 403);
    }
  } catch (error) {
    console.error(error);
    return respond({ error: "Could not post" }, 500);
  }
  const text = String(body.text || "")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .trim();

  if (!text) return respond({ error: "Write something first" }, 400);
  if (text.length > MAX_TEXT) return respond({ error: `Max ${MAX_TEXT} characters` }, 400);

  try {
    const ip = clientHash(request);
    const now = Date.now();
    const recent = await recentMessages(thread, 15);
    const tooSoon = recent.some((m) => m.ip === ip && now - Date.parse(m.ts) < COOLDOWN_MS);
    const repeat = recent.some((m) => m.ip === ip && m.text === text);
    if (tooSoon) return respond({ error: "Slow down a little" }, 429);
    if (repeat) return respond({ error: "You already said that" }, 429);

    const message = { name, text, ts: new Date(now).toISOString(), ip };
    if (viewer) Object.assign(message, { user: viewer.name, color: viewer.color });
    await putJson(`comments/${thread}/${message.ts}.json`, message, { suffix: true });
    return respond({ ok: true, message: publicView(message) });
  } catch (error) {
    console.error(error);
    return respond({ error: "Could not post" }, 500);
  }
}
