import { scrypt, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { getJson, putJson, listBlobs } from "./_store.js";

export const USER_RE = /^[A-Za-z0-9_-]{3,20}$/;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const AVATARS = 23;
const RESERVED = new Set([
  "admin", "administrator", "mod", "moderator", "owner", "staff", "system", "root",
  "sanguine", "nocturne", "herr-myrden", "herrmyrden", "myrden", "anonymous", "guest",
]);
const SESSION_DAYS = 30;
const MAX_BODY = 6000;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, message) => {
  throw new HttpError(status, message);
};

export function respond(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

export const wrap = (fn) => async (request) => {
  try {
    return await fn(request);
  } catch (error) {
    if (error instanceof HttpError) return respond({ error: error.message }, error.status);
    console.error(error);
    return respond({ error: "Something broke, try again" }, 500);
  }
};

export async function readJson(request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {}
    if (originHost !== host) fail(403, "Bad origin");
  }
  if (!(request.headers.get("content-type") || "").includes("application/json")) fail(415, "Bad request");
  const raw = await request.text();
  if (raw.length > MAX_BODY) fail(413, "Too long");
  try {
    const body = JSON.parse(raw);
    if (body && typeof body === "object") return body;
  } catch {}
  return fail(400, "Bad request");
}

export const keyOf = (name) => String(name).toLowerCase();
export const clean = (value, max) =>
  String(value ?? "")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);

export function clientHash(request) {
  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  return createHash("sha256")
    .update(ip + (process.env.COMMENT_SALT || "sanguine"))
    .digest("hex")
    .slice(0, 24);
}

const scryptAsync = (password, salt) =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key)))
  );

export async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: (await scryptAsync(password, salt)).toString("hex") };
}

export async function checkPassword(password, user) {
  // Always hash, even for unknown users, so timing doesn't reveal which names exist.
  const salt = user?.salt || "0".repeat(32);
  const given = await scryptAsync(String(password), salt);
  const real = Buffer.from(user?.hash || "0".repeat(128), "hex");
  return Boolean(user) && given.length === real.length && timingSafeEqual(given, real);
}

export function validPassword(password) {
  if (typeof password !== "string" || password.length < 6 || password.length > 100) {
    fail(400, "Password must be 6-100 characters");
  }
}

const tokenHash = (token) => createHash("sha256").update(token).digest("hex");

export async function startSession(key) {
  const token = randomBytes(32).toString("hex");
  const exp = Date.now() + SESSION_DAYS * 86400000;
  await putJson(`sessions/${tokenHash(token)}.json`, { user: key, exp });
  return cookie(token, SESSION_DAYS * 86400);
}

export const cookie = (value, maxAge) =>
  `sn_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

function tokenFrom(request) {
  const match = (request.headers.get("cookie") || "").match(/(?:^|;\s*)sn_session=([a-f0-9]{64})/);
  return match ? match[1] : null;
}

export async function endSession(request) {
  const token = tokenFrom(request);
  if (token) await putJson(`sessions/${tokenHash(token)}.json`, { user: "", exp: 0 });
}

// Returns the logged-in account record (with a `key` field), or null.
export async function getViewer(request) {
  const token = tokenFrom(request);
  if (!token) return null;
  const session = await getJson(`sessions/${tokenHash(token)}.json`);
  if (!session || !session.user || session.exp < Date.now()) return null;
  const user = await getJson(`users/${session.user}.json`);
  return user ? { ...user, key: session.user } : null;
}

export async function requireViewer(request) {
  return (await getViewer(request)) || fail(401, "Sign in first");
}

export const publicProfile = (u) => ({
  name: u.name,
  color: u.color,
  avatar: u.avatar,
  bio: u.bio || "",
  mood: u.mood || "",
  pronouns: u.pronouns || "",
  quote: u.quote || "",
  accent: u.accent || "",
  joined: u.joined,
  owner: Boolean(u.owner),
});

export const loadUser = (key) => getJson(`users/${key}.json`);

export function userKeyParam(value) {
  const name = String(value || "");
  return USER_RE.test(name) ? keyOf(name) : fail(400, "Bad username");
}

export function checkName(name, isOwner = false) {
  if (!USER_RE.test(name)) fail(400, "Username: 3-20 letters, numbers, _ or -");
  if (RESERVED.has(keyOf(name)) && !isOwner) fail(400, "That name is taken");
}

// The site owner proves who they are with OWNER_CODE (set in Vercel env vars).
export function ownerCodeOk(code) {
  const real = process.env.OWNER_CODE;
  if (!real || typeof code !== "string") return false;
  const a = createHash("sha256").update(code).digest();
  const b = createHash("sha256").update(real).digest();
  return timingSafeEqual(a, b);
}

// Edge blobs: rel/<me>/<friend|in|out>-<other>.json
export async function relations(key) {
  const out = { friend: [], in: [], out: [] };
  for (const b of await listBlobs(`rel/${key}/`)) {
    const m = b.pathname.slice(`rel/${key}/`.length).match(/^(friend|in|out)-(.+)\.json$/);
    if (m) out[m[1]].push(m[2]);
  }
  return out;
}

export async function relationBetween(me, other) {
  if (await getJson(`rel/${me}/friend-${other}.json`)) return "friend";
  if (await getJson(`rel/${me}/in-${other}.json`)) return "in";
  if (await getJson(`rel/${me}/out-${other}.json`)) return "out";
  return "none";
}

export const nameFromPath = (pathname) => pathname.split("/").pop().replace(/\.json$/, "");

// Senders whose latest message is newer than the last time I opened that conversation.
export async function unreadFrom(key) {
  const [inbox, reads] = await Promise.all([listBlobs(`inbox/${key}/`), listBlobs(`read/${key}/`)]);
  const readAt = new Map(reads.map((b) => [nameFromPath(b.pathname), b.at]));
  return inbox
    .map((b) => ({ from: nameFromPath(b.pathname), at: b.at }))
    .filter((m) => m.at > (readAt.get(m.from) || 0));
}

// Check the cooldown without recording it; call markThrottle once the action succeeded.
export async function throttle(request, label, ms) {
  const last = await getJson(`throttle/${label}-${clientHash(request)}.json`);
  if (last && Date.now() - last.at < ms) fail(429, `Please wait ${Math.ceil(ms / 1000)} seconds before trying again`);
}

export const markThrottle = (request, label) =>
  putJson(`throttle/${label}-${clientHash(request)}.json`, { at: Date.now() });

export async function throttleUser(key, label, ms) {
  const path = `throttle/u-${label}-${key}.json`;
  const last = await getJson(path);
  if (last && Date.now() - last.at < ms) fail(429, "Slow down a little");
  await putJson(path, { at: Date.now() });
}
