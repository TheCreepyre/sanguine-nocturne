import { putJson, getJson, listBlobs } from "./_store.js";
import {
  wrap, respond, fail, readJson, requireViewer, loadUser, userKeyParam, relationBetween, clean, unreadFrom, nameFromPath,
} from "./_lib.js";

const MAX_TEXT = 1000;
const COOLDOWN_MS = 1500;
const pairOf = (a, b) => [a, b].sort().join("~");

export const GET = wrap(async (request) => {
  const viewer = await requireViewer(request);
  const me = viewer.key;
  const params = new URL(request.url).searchParams;

  if (!params.has("with")) {
    const [convos, unread] = await Promise.all([listBlobs(`convo/${me}/`), unreadFrom(me)]);
    const unreadSet = new Set(unread.map((u) => u.from));
    const items = await Promise.all(
      convos.map(async (c) => {
        const key = nameFromPath(c.pathname);
        const u = await loadUser(key);
        return u && { name: u.name, color: u.color, avatar: u.avatar, at: c.at, unread: unreadSet.has(key) };
      })
    );
    return respond({ conversations: items.filter(Boolean).sort((a, b) => b.at - a.at) });
  }

  const other = userKeyParam(params.get("with"));
  const user = await loadUser(other);
  if (!user) fail(404, "No such user");
  const blobs = (await listBlobs(`dm/${pairOf(me, other)}/`)).slice(-100);
  const msgs = await Promise.all(blobs.map((b) => getJson(b.pathname).catch(() => null)));
  if (params.get("mark")) await putJson(`read/${me}/${other}.json`, { at: Date.now() });
  const friends = (await relationBetween(me, other)) === "friend";
  return respond({
    with: { name: user.name, color: user.color, avatar: user.avatar },
    friends,
    messages: msgs.filter(Boolean).map((m) => ({ mine: m.from === me, text: m.text, ts: m.ts })),
  });
});

export const POST = wrap(async (request) => {
  const viewer = await requireViewer(request);
  const body = await readJson(request);
  const me = viewer.key;
  const other = userKeyParam(body.to);
  if (other === me) fail(400, "Talk to yourself in your head");
  if (!(await loadUser(other))) fail(404, "No such user");
  if ((await relationBetween(me, other)) !== "friend") fail(403, "You can only message friends");

  const text = clean(body.text, MAX_TEXT + 1);
  if (!text) fail(400, "Write something first");
  if (text.length > MAX_TEXT) fail(400, `Max ${MAX_TEXT} characters`);

  const last = await getJson(`convo/${me}/${other}.json`);
  if (last && Date.now() - last.at < COOLDOWN_MS) fail(429, "Slow down a little");

  const now = Date.now();
  const message = { from: me, text, ts: new Date(now).toISOString() };
  await putJson(`dm/${pairOf(me, other)}/${message.ts}.json`, message, { suffix: true });
  await Promise.all([
    putJson(`convo/${me}/${other}.json`, { at: now }),
    putJson(`convo/${other}/${me}.json`, { at: now }),
    putJson(`inbox/${other}/${me}.json`, { at: now }),
    putJson(`read/${me}/${other}.json`, { at: now }),
  ]);
  return respond({ ok: true, message: { mine: true, text, ts: message.ts } });
});
