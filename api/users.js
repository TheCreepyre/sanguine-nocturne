import { listBlobs } from "./_store.js";
import { wrap, respond, fail, getViewer, loadUser, publicProfile, relationBetween, keyOf } from "./_lib.js";

export const GET = wrap(async (request) => {
  const params = new URL(request.url).searchParams;
  const viewer = await getViewer(request);

  if (params.has("q")) {
    const q = keyOf(params.get("q")).trim();
    if (!/^[a-z0-9_-]{1,20}$/.test(q)) return respond({ users: [] });
    const found = (await listBlobs(`users/${q}`)).slice(0, 30);
    const users = await Promise.all(found.map((b) => loadUser(b.pathname.slice(6, -5))));
    return respond({
      users: users.filter((u) => u && !u.banned && !u.settings?.hidden).map((u) => ({ name: u.name, color: u.color, avatar: u.avatar, pfp: u.pfp || 0 })),
    });
  }

  if (params.has("owner")) {
    for (const key of ["herr-myrden", "herr_myrden", "herrmyrden"]) {
      const u = await loadUser(key);
      if (u && u.owner) return respond({ user: publicProfile(u) });
    }
    return respond({ user: null });
  }

  const key = keyOf(params.get("name") || "");
  if (!/^[a-z0-9_-]{3,20}$/.test(key)) fail(400, "Bad username");
  const user = await loadUser(key);
  if (!user || (user.banned && !viewer?.owner)) fail(404, "No such user");
  const relation = viewer && viewer.key !== key ? await relationBetween(viewer.key, key) : "none";
  return respond({ user: publicProfile(user), relation, self: viewer?.key === key });
});
