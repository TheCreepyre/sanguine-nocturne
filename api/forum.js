import { putJson, getJson, listBlobs, delPath } from "./_store.js";
import { wrap, respond, fail, readJson, requireViewer, getViewer, clean, throttleUser } from "./_lib.js";
import { MEDIA_RE } from "./media.js";

const BOARDS = [
  ["general", "General", "anything goes (almost)"],
  ["lore", "Lore talk", "theories, worldbuilding, questions"],
  ["art", "Art & characters", "share drawings, ocs, feedback"],
  ["introductions", "Introductions", "say hi, tell us who you are"],
  ["offtopic", "Off topic", "cats, music, 3am thoughts"],
];
const BOARD_IDS = new Set(BOARDS.map((b) => b[0]));
const ID_RE = /^\d{13}-[a-z0-9]{6}$/;
const LIST_LIMIT = 40;
const REPLY_LIMIT = 200;

const newId = () => `${String(Date.now()).padStart(13, "0")}-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
const board = (v) => (BOARD_IDS.has(v) ? v : fail(400, "Unknown board"));
const threadId = (v) => (ID_RE.test(String(v)) ? String(v) : fail(400, "Bad thread"));

const view = (p) => ({
  id: p.id, title: p.title, text: p.text, author: p.author, color: p.color, owner: Boolean(p.owner), ts: p.ts,
  media: p.media || [],
});

const mediaList = (value) => {
  const list = Array.isArray(value) ? value.slice(0, 4) : [];
  return list.every((m) => MEDIA_RE.test(String(m))) ? list.map(String) : fail(400, "Bad attachment");
};

export const GET = wrap(async (request) => {
  const params = new URL(request.url).searchParams;
  const viewer = await getViewer(request);
  const can = viewer ? { user: viewer.key, owner: Boolean(viewer.owner) } : null;

  if (!params.has("board")) {
    const counts = await Promise.all(BOARDS.map(async ([id]) => (await listBlobs(`threads/${id}/`)).length));
    return respond({ boards: BOARDS.map(([id, name, desc], i) => ({ id, name, desc, threads: counts[i] })) });
  }

  const b = board(params.get("board"));
  if (!params.has("thread")) {
    const items = (await listBlobs(`threads/${b}/`)).slice(-LIST_LIMIT).reverse();
    const threads = (await Promise.all(items.map((i) => getJson(i.pathname).catch(() => null)))).filter(Boolean);
    const withCounts = await Promise.all(
      threads.map(async (t) => ({ ...view(t), text: undefined, replies: (await listBlobs(`replies/${t.id}/`)).length }))
    );
    return respond({ board: b, threads: withCounts, me: can });
  }

  const id = threadId(params.get("thread"));
  const thread = await getJson(`threads/${b}/${id}.json`);
  if (!thread) fail(404, "No such thread");
  const rs = (await listBlobs(`replies/${id}/`)).slice(-REPLY_LIMIT);
  const replies = (await Promise.all(rs.map((r) => getJson(r.pathname).catch(() => null)))).filter(Boolean);
  return respond({ thread: { ...view(thread), authorKey: thread.userKey }, replies: replies.map((r) => ({ ...view(r), authorKey: r.userKey })), me: can });
});

export const POST = wrap(async (request) => {
  const viewer = await requireViewer(request);
  const body = await readJson(request);
  const b = board(body.board);
  const author = { author: viewer.name, userKey: viewer.key, color: viewer.color, owner: Boolean(viewer.owner) };

  switch (body.action) {
    case "thread": {
      const title = clean(body.title, 80);
      const text = clean(body.text, 3000);
      const media = mediaList(body.media);
      if (title.length < 3) fail(400, "Give it a title (3+ characters)");
      if (!text && !media.length) fail(400, "Write something first");
      await throttleUser(viewer.key, "thread", 20000);
      const id = newId();
      await putJson(`threads/${b}/${id}.json`, { id, title, text, media, ts: new Date().toISOString(), ...author }, { overwrite: false });
      return respond({ id });
    }
    case "reply": {
      const id = threadId(body.thread);
      const text = clean(body.text, 2000);
      const media = mediaList(body.media);
      if (!text && !media.length) fail(400, "Write something first");
      if (!(await getJson(`threads/${b}/${id}.json`))) fail(404, "No such thread");
      await throttleUser(viewer.key, "reply", 5000);
      const rid = newId();
      await putJson(`replies/${id}/${rid}.json`, { id: rid, text, media, ts: new Date().toISOString(), ...author }, { overwrite: false });
      return respond({ ok: true });
    }
    case "delete": {
      const id = threadId(body.thread);
      const isOwner = Boolean(viewer.owner);
      if (body.reply) {
        const rid = threadId(body.reply);
        const reply = await getJson(`replies/${id}/${rid}.json`);
        if (!reply) return respond({ ok: true });
        if (!isOwner && reply.userKey !== viewer.key) fail(403, "Not yours to delete");
        await Promise.all([delPath(`replies/${id}/${rid}.json`), ...(reply.media || []).map((m) => delPath(`media/${m}`))]);
        return respond({ ok: true });
      }
      const thread = await getJson(`threads/${b}/${id}.json`);
      if (!thread) return respond({ ok: true });
      if (!isOwner && thread.userKey !== viewer.key) fail(403, "Not yours to delete");
      const rs = await listBlobs(`replies/${id}/`);
      const replies = await Promise.all(rs.map((r) => getJson(r.pathname).catch(() => null)));
      const files = [thread, ...replies].flatMap((p) => (p && p.media) || []);
      await Promise.all([
        delPath(`threads/${b}/${id}.json`),
        ...rs.map((r) => delPath(r.pathname)),
        ...files.map((m) => delPath(`media/${m}`)),
      ]);
      return respond({ ok: true });
    }
    default:
      return fail(400, "Bad request");
  }
});
