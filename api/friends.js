import { putJson, delPath } from "./_store.js";
import {
  wrap, respond, fail, readJson, requireViewer, loadUser, relations, relationBetween,
  userKeyParam,
} from "./_lib.js";

const MAX_FRIENDS = 300;
const stamp = () => ({ at: Date.now() });

const card = (u) => ({ name: u.name, color: u.color, avatar: u.avatar, pfp: u.pfp || 0, mood: u.mood || "" });
async function cards(keys) {
  const users = await Promise.all(keys.map(loadUser));
  return users.filter(Boolean).map(card);
}

export const GET = wrap(async (request) => {
  const viewer = await requireViewer(request);
  const rel = await relations(viewer.key);
  const [friends, incoming, outgoing] = await Promise.all([cards(rel.friend), cards(rel.in), cards(rel.out)]);
  return respond({ friends, incoming, outgoing });
});

async function makeFriends(a, b) {
  await Promise.all([
    putJson(`rel/${a}/friend-${b}.json`, stamp()),
    putJson(`rel/${b}/friend-${a}.json`, stamp()),
    delPath(`rel/${a}/in-${b}.json`),
    delPath(`rel/${a}/out-${b}.json`),
    delPath(`rel/${b}/in-${a}.json`),
    delPath(`rel/${b}/out-${a}.json`),
  ]);
}

export const POST = wrap(async (request) => {
  const viewer = await requireViewer(request);
  const body = await readJson(request);
  const me = viewer.key;
  const other = userKeyParam(body.to);
  if (other === me) fail(400, "That's you");
  const target = await loadUser(other);
  if (!target) fail(404, "No such user");
  const state = await relationBetween(me, other);

  switch (body.action) {
    case "request":
      if (state === "friend" || state === "out") return respond({ relation: state });
      if (state === "in") {
        await makeFriends(me, other);
        return respond({ relation: "friend" });
      }
      if ((await relations(me)).friend.length >= MAX_FRIENDS) fail(400, "Friend list is full");
      await Promise.all([putJson(`rel/${me}/out-${other}.json`, stamp()), putJson(`rel/${other}/in-${me}.json`, stamp())]);
      return respond({ relation: "out" });
    case "accept":
      if (state !== "in") fail(400, "No request from them");
      await makeFriends(me, other);
      return respond({ relation: "friend" });
    case "decline":
    case "cancel":
      await Promise.all([
        delPath(`rel/${me}/in-${other}.json`), delPath(`rel/${other}/out-${me}.json`),
        delPath(`rel/${me}/out-${other}.json`), delPath(`rel/${other}/in-${me}.json`),
      ]);
      return respond({ relation: "none" });
    case "remove":
      await Promise.all([delPath(`rel/${me}/friend-${other}.json`), delPath(`rel/${other}/friend-${me}.json`)]);
      return respond({ relation: "none" });
    default:
      return fail(400, "Bad request");
  }
});
