import { putJson } from "./_store.js";
import {
  COLOR_RE, AVATARS, wrap, respond, fail, readJson, keyOf, clean, checkName, hashPassword,
  checkPassword, validPassword, startSession, endSession, cookie, getViewer, requireViewer,
  loadUser, publicProfile, relations, unreadFrom, throttle,
} from "./_lib.js";

const LOCK_AFTER = 5;
const LOCK_MS = 60000;

function color(value) {
  return COLOR_RE.test(value) ? value.toLowerCase() : fail(400, "Pick a valid colour");
}

function me(user) {
  return { ...publicProfile(user) };
}

export const GET = wrap(async (request) => {
  const viewer = await getViewer(request);
  if (!viewer) return respond({ user: null });
  const out = { user: me(viewer) };
  if (new URL(request.url).searchParams.get("counts")) {
    const [rel, unread] = await Promise.all([relations(viewer.key), unreadFrom(viewer.key)]);
    out.counts = { requests: rel.in.length, unread: unread.length };
  }
  return respond(out);
});

async function register(request, body) {
  const name = String(body.name || "").trim();
  checkName(name);
  validPassword(body.password);
  const key = keyOf(name);
  await throttle(request, "reg", 30000);
  const { salt, hash } = await hashPassword(body.password);
  const user = {
    name,
    color: color(String(body.color || "")),
    avatar: 1 + Math.floor(Math.random() * AVATARS),
    bio: "", mood: "", pronouns: "", quote: "", accent: "",
    salt, hash, joined: new Date().toISOString(), fails: 0, lockUntil: 0,
  };
  try {
    await putJson(`users/${key}.json`, user, { overwrite: false });
  } catch {
    fail(409, "That name is taken");
  }
  return respond({ user: me(user) }, 200, { "set-cookie": await startSession(key) });
}

async function login(body) {
  const name = String(body.name || "").trim();
  const key = keyOf(name);
  const bad = () => fail(401, "Wrong name or password");
  const user = /^[a-z0-9_-]{3,20}$/.test(key) ? await loadUser(key) : null;
  if (user && user.lockUntil > Date.now()) fail(429, "Too many tries, wait a minute");
  const ok = await checkPassword(body.password, user);
  if (!ok) {
    if (user) {
      const fails = (user.fails || 0) + 1;
      await putJson(`users/${key}.json`, {
        ...user, fails: fails >= LOCK_AFTER ? 0 : fails, lockUntil: fails >= LOCK_AFTER ? Date.now() + LOCK_MS : 0,
      });
    }
    bad();
  }
  if (user.fails) await putJson(`users/${key}.json`, { ...user, fails: 0, lockUntil: 0 });
  return respond({ user: me(user) }, 200, { "set-cookie": await startSession(key) });
}

async function update(request, body) {
  const viewer = await requireViewer(request);
  const { key, ...user } = viewer;
  if ("color" in body) user.color = color(String(body.color));
  if ("accent" in body) user.accent = body.accent === "" ? "" : color(String(body.accent));
  if ("avatar" in body) {
    const n = Number(body.avatar);
    if (!Number.isInteger(n) || n < 1 || n > AVATARS) fail(400, "Bad avatar");
    user.avatar = n;
  }
  if ("bio" in body) user.bio = clean(body.bio, 500);
  if ("mood" in body) user.mood = clean(body.mood, 30);
  if ("pronouns" in body) user.pronouns = clean(body.pronouns, 30);
  if ("quote" in body) user.quote = clean(body.quote, 120);
  if (body.newPassword) {
    if (!(await checkPassword(body.password, user))) fail(401, "Current password is wrong");
    validPassword(body.newPassword);
    Object.assign(user, await hashPassword(body.newPassword));
  }
  await putJson(`users/${key}.json`, user);
  return respond({ user: me(user) });
}

export const POST = wrap(async (request) => {
  const body = await readJson(request);
  switch (body.action) {
    case "register": return register(request, body);
    case "login": return login(body);
    case "logout":
      await endSession(request);
      return respond({ ok: true }, 200, { "set-cookie": cookie("", 0) });
    case "update": return update(request, body);
    default: return fail(400, "Bad request");
  }
});
