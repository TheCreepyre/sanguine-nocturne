import { putJson, listBlobs, delPath } from "./_store.js";
import {
  COLOR_RE, wrap, respond, fail, readJson, requireViewer, loadUser, userKeyParam, clean, hashPassword, validPassword,
} from "./_lib.js";

// Everything here is owner-only; the check runs on every request.
const requireOwner = async (request) => {
  const viewer = await requireViewer(request);
  return viewer.owner ? viewer : fail(403, "Owner only");
};

const row = (u) => ({
  name: u.name, color: u.color, owner: Boolean(u.owner), banned: Boolean(u.banned), joined: u.joined,
  avatar: u.avatar, pfp: u.pfp || 0, bio: u.bio || "", mood: u.mood || "", pronouns: u.pronouns || "", quote: u.quote || "",
});

export const GET = wrap(async (request) => {
  await requireOwner(request);
  const blobs = (await listBlobs("users/")).slice(0, 500);
  const users = await Promise.all(blobs.map((b) => loadUser(b.pathname.slice(6, -5)).catch(() => null)));
  return respond({ users: users.filter(Boolean).map(row) });
});

export const POST = wrap(async (request) => {
  const owner = await requireOwner(request);
  const body = await readJson(request);
  const key = userKeyParam(body.name);
  const user = await loadUser(key);
  if (!user) fail(404, "No such user");
  if (user.owner && key !== owner.key) fail(403, "Can't touch another owner");

  switch (body.action) {
    case "ban":
    case "unban":
      if (key === owner.key) fail(400, "You can't ban yourself");
      user.banned = body.action === "ban";
      await putJson(`users/${key}.json`, user);
      return respond({ user: row(user) });
    case "edit":
      for (const [field, max] of [["bio", 500], ["mood", 30], ["pronouns", 30], ["quote", 120]]) {
        if (field in body) user[field] = clean(body[field], max);
      }
      if ("color" in body) {
        if (!COLOR_RE.test(String(body.color))) fail(400, "Bad colour");
        user.color = String(body.color).toLowerCase();
      }
      if (body.removePfp) {
        user.pfp = 0;
        await delPath(`avatars/${key}.json`);
      }
      if (body.newPassword) {
        validPassword(body.newPassword);
        Object.assign(user, await hashPassword(body.newPassword), { fails: 0, lockUntil: 0 });
      }
      await putJson(`users/${key}.json`, user);
      return respond({ user: row(user) });
    case "delete":
      if (key === owner.key) fail(400, "You can't delete yourself");
      await Promise.all([delPath(`users/${key}.json`), delPath(`avatars/${key}.json`)]);
      return respond({ ok: true });
    default:
      return fail(400, "Bad request");
  }
});
