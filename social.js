// Account, profile, friends and messages pages. Relies on helpers from site.js.
const app = document.getElementById("app");
const page = document.body.dataset.page;
const params = new URLSearchParams(location.search);

async function api(path, body) {
  if (location.protocol === "file:") {
    throw new Error("accounts only work on the live site (sanguine-nocturne.vercel.app), not from a local file");
  }
  let res;
  try {
    res = await fetch("/api/" + path, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("can't reach the server, check your connection and try again");
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error("the server isn't answering properly right now (" + res.status + "), try again in a moment");
  if (!res.ok) throw new Error(data.error || "something went wrong");
  return data;
}

function box(title, ...children) {
  const b = el("div", "box");
  if (title) b.append(el("h2", "", title));
  b.append(...children);
  return b;
}

function button(label, onClick, className = "pill") {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await onClick();
    } finally {
      b.disabled = false;
    }
  });
  return b;
}

function field(label, input) {
  const wrap = el("label", "field");
  wrap.append(el("span", "", label), input);
  return wrap;
}

function input(attrs = {}) {
  const i = el("input");
  Object.assign(i, attrs);
  return i;
}

function memberRow(u, ...actions) {
  const row = el("div", "member");
  const img = el("img", "member-avatar");
  img.src = avatarSrc(u);
  img.alt = "";
  const info = el("div", "member-info");
  info.append(nameTag(u.name, u.color));
  if (u.mood) info.append(el("span", "dim", " " + u.mood));
  const acts = el("div", "member-actions");
  acts.append(...actions);
  row.append(img, info, acts);
  return row;
}

function messageLink(name) {
  const a = el("a", "pill", "Message");
  a.href = "messages.html?with=" + encodeURIComponent(name);
  return a;
}

function notice() {
  const p = el("p", "thread-status");
  p.setAttribute("aria-live", "polite");
  return p;
}

async function needLogin(me) {
  if (me.user) return true;
  app.replaceChildren(
    box("Sign in needed", el("p", "", "you need an account for this."), Object.assign(el("a", "pill", "Sign in / Join"), { href: "account.html" }))
  );
  return false;
}

// ---------- account ----------
function authForm(mode) {
  const msg = notice();
  const name = input({ name: "name", maxLength: 20, autocomplete: "username", required: true });
  const pass = input({ name: "password", type: "password", autocomplete: mode === "join" ? "new-password" : "current-password", required: true, maxLength: 100 });
  const color = input({ type: "color", value: "#ff2a2a" });
  const owner = input({ name: "ownerCode", type: "password", autocomplete: "off", placeholder: "owner code (only for the site owner)" });
  const form = el("form", "stack");
  form.append(field("Username", name), field("Password", pass));
  if (mode === "join") {
    form.append(field("Name colour", color), el("p", "dim", "3-20 letters, numbers, _ or -. password 6+ characters. there is no email, so if you forget your password it's gone for good."));
    const d = el("details");
    d.append(el("summary", "dim", "i own this site"), owner);
    form.append(d);
  }
  const go = el("button", "pill", mode === "join" ? "Join" : "Sign in");
  go.type = "submit";
  form.append(go, msg);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    go.disabled = true;
    msg.textContent = "...";
    try {
      const body = { action: mode === "join" ? "register" : "login", name: name.value, password: pass.value };
      if (mode === "join") {
        body.color = color.value;
        if (owner.value) body.ownerCode = owner.value;
      }
      const { user } = await api("auth", body);
      location.href = "profile.html?u=" + encodeURIComponent(user.name);
    } catch (error) {
      msg.textContent = error.message;
      go.disabled = false;
    }
  });
  return form;
}

// Shrinks the chosen picture to 128x128 and re-encodes it, so only a clean small image is uploaded.
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const size = 128;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      const tryType = (type, quality, next) =>
        canvas.toBlob((blob) => (blob && blob.type === type ? resolve(blob) : next()), type, quality);
      tryType("image/webp", 0.85, () => tryType("image/png", undefined, () => reject(new Error("can't process that image"))));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("that file isn't an image the browser can read"));
    };
    img.src = url;
  });
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("couldn't read the image"));
    r.readAsDataURL(blob);
  });
}

function pfpControl(user) {
  const wrap = el("div", "pfp-control");
  const preview = el("img", "pfp-preview");
  preview.src = avatarSrc(user);
  preview.alt = "Your current picture";
  const file = input({ type: "file", accept: "image/png,image/jpeg,image/webp,image/gif" });
  const msg = notice();
  file.addEventListener("change", async () => {
    const chosen = file.files[0];
    if (!chosen) return;
    msg.textContent = "uploading...";
    try {
      if (chosen.size > 8 * 1024 * 1024) throw new Error("pick an image under 8 MB");
      const blob = await resizeImage(chosen);
      const { pfp } = await api("avatar", { type: blob.type, data: await toBase64(blob) });
      user.pfp = pfp;
      preview.src = avatarSrc(user);
      msg.textContent = "picture updated.";
    } catch (error) {
      msg.textContent = error.message;
    }
    file.value = "";
  });
  const remove = button("Remove picture", async () => {
    try {
      await api("avatar", { remove: true });
      user.pfp = 0;
      preview.src = avatarSrc(user);
      msg.textContent = "picture removed.";
    } catch (error) {
      msg.textContent = error.message;
    }
  });
  const side = el("div", "stack");
  side.append(file, remove, msg);
  wrap.append(preview, side);
  return wrap;
}

function accountEditor(user) {
  const msg = notice();
  let avatar = user.avatar;
  let presetPicked = false;
  const grid = el("div", "avatar-grid");
  for (let n = 1; n <= 23; n++) {
    const b = el("button", "avatar-pick");
    b.type = "button";
    b.setAttribute("aria-label", "Avatar " + n);
    const img = el("img");
    img.src = avatarSrc(n);
    img.alt = "";
    b.append(img);
    if (n === avatar) b.classList.add("on");
    b.addEventListener("click", () => {
      avatar = n;
      presetPicked = true;
      grid.querySelectorAll(".on").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    });
    grid.append(b);
  }
  const color = input({ type: "color", value: user.color });
  const accent = input({ type: "color", value: user.accent || "#8b0000" });
  const noAccent = input({ type: "checkbox", checked: !user.accent });
  const mood = input({ maxLength: 30, value: user.mood });
  const pronouns = input({ maxLength: 30, value: user.pronouns });
  const quote = input({ maxLength: 120, value: user.quote });
  const bio = el("textarea");
  bio.maxLength = 500;
  bio.rows = 5;
  bio.value = user.bio;
  const accentWrap = el("div", "field");
  const defaultLabel = el("label", "inline");
  defaultLabel.append(noAccent, " use default");
  accentWrap.append(el("span", "", "Profile accent colour"), accent, defaultLabel);

  const form = el("form", "stack");
  form.append(el("h3", "", "Profile picture"), pfpControl(user), el("p", "dim", "or pick a preset:"), grid);
  form.append(
    field("Name colour", color), accentWrap,
    field("Mood", mood), field("Pronouns", pronouns), field("Quote", quote), field("About me", bio)
  );
  const save = el("button", "pill", "Save profile");
  save.type = "submit";
  form.append(save, msg);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      if (presetPicked && user.pfp) {
        await api("avatar", { remove: true });
        user.pfp = 0;
      }
      await api("auth", {
        action: "update", avatar, color: color.value, accent: noAccent.checked ? "" : accent.value,
        mood: mood.value, pronouns: pronouns.value, quote: quote.value, bio: bio.value,
      });
      msg.textContent = "saved.";
    } catch (error) {
      msg.textContent = error.message;
    }
    save.disabled = false;
  });

  const pwMsg = notice();
  const cur = input({ type: "password", autocomplete: "current-password" });
  const next = input({ type: "password", autocomplete: "new-password", maxLength: 100 });
  const pwForm = el("form", "stack");
  const pwGo = el("button", "pill", "Change password");
  pwGo.type = "submit";
  pwForm.append(field("Current password", cur), field("New password", next), pwGo, pwMsg);
  pwForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("auth", { action: "update", password: cur.value, newPassword: next.value });
      cur.value = next.value = "";
      pwMsg.textContent = "password changed.";
    } catch (error) {
      pwMsg.textContent = error.message;
    }
  });

  const out = button("Sign out", async () => {
    await api("auth", { action: "logout" });
    location.href = "index.html";
  });
  return [box("Edit profile", form), box("Password", pwForm), box("", out)];
}

async function initAccount(me) {
  if (me.user) {
    app.replaceChildren(...accountEditor(me.user));
    return;
  }
  const join = params.has("join");
  const holder = el("div");
  const tabs = el("p", "small-links");
  const show = (mode) => {
    holder.replaceChildren(authForm(mode));
    tabs.replaceChildren(
      ...["login", "join"].map((m) => {
        const b = el("button", "pill" + (m === mode ? " on" : ""), m === "join" ? "Join" : "Sign in");
        b.type = "button";
        b.addEventListener("click", () => show(m));
        return b;
      })
    );
  };
  show(join ? "join" : "login");
  app.replaceChildren(box("Account", tabs, holder));
}

// ---------- profile ----------
async function initProfile(me) {
  const wanted = params.get("u") || (me.user && me.user.name) || "";
  if (!USER_OK.test(wanted)) {
    app.replaceChildren(box("Profile", el("p", "", "no such person. "), Object.assign(el("a", "pill", "Find people"), { href: "friends.html" })));
    return;
  }
  let data;
  try {
    data = await api("users?name=" + encodeURIComponent(wanted));
  } catch (error) {
    app.replaceChildren(box("Profile", el("p", "", error.message)));
    return;
  }
  const { user, self } = data;
  let relation = data.relation;
  document.title = user.name + " - Sanguine Nocturne";

  const head = el("div", "char-head");
  const img = el("img", "photo");
  img.src = avatarSrc(user);
  img.alt = "";
  const side = el("div");
  const title = el("h3", "profile-name");
  title.append(nameTag(user.name, user.color, user.owner));
  side.append(title);
  if (user.quote) side.append(el("p", "dim", `"${user.quote}"`));
  if (user.mood) side.append(el("p", "mood", "Mood: " + user.mood));
  head.append(img, side);

  const actions = el("div", "member-actions");
  const msg = notice();
  const drawActions = () => {
    actions.replaceChildren();
    const act = (label, action) => button(label, async () => {
      try {
        relation = (await api("friends", { action, to: user.name })).relation;
        drawActions();
      } catch (error) {
        msg.textContent = error.message;
      }
    });
    if (self) {
      actions.append(Object.assign(el("a", "pill", "Edit profile"), { href: "account.html" }));
    } else if (!me.user) {
      actions.append(Object.assign(el("a", "pill", "Sign in to add friend"), { href: "account.html" }));
    } else if (relation === "friend") {
      actions.append(messageLink(user.name), act("Remove friend", "remove"));
    } else if (relation === "out") {
      actions.append(act("Request sent (cancel)", "cancel"));
    } else if (relation === "in") {
      actions.append(act("Accept request", "accept"), act("Decline", "decline"));
    } else {
      actions.append(act("Add friend", "request"));
    }
  };
  drawActions();

  const details = el("table", "interests");
  const rows = [["Pronouns", user.pronouns], ["Joined", new Date(user.joined).toLocaleDateString()]];
  for (const [k, v] of rows) {
    if (!v) continue;
    const tr = el("tr");
    tr.append(el("th", "", k), el("td", "", v));
    details.append(tr);
  }

  const main = box(user.name, head, actions, msg, el("h3", "", "About me"), el("p", "", user.bio || "nothing here yet."), details);
  if (COLOR_OK.test(user.accent || "")) {
    main.style.borderColor = user.accent;
    main.querySelector("h2").style.color = user.accent;
  }

  const wall = el("div", "thread");
  wall.dataset.thread = "user-" + user.name.toLowerCase();
  wall.dataset.limit = "100";
  wall.dataset.empty = "nobody has written on this wall yet.";
  app.replaceChildren(main, box("Wall", wall));
  initThread(wall);
}

// ---------- friends ----------
async function initFriends(me) {
  if (!(await needLogin(me))) return;
  const holder = el("div");
  const msg = notice();

  async function act(action, to) {
    try {
      await api("friends", { action, to });
      await draw();
    } catch (error) {
      msg.textContent = error.message;
    }
  }

  async function draw() {
    const { friends, incoming, outgoing } = await api("friends");
    const sections = [];
    const section = (title, list, makeActions, empty) => {
      const b = box(title);
      if (!list.length) b.append(el("p", "dim", empty));
      for (const u of list) b.append(memberRow(u, ...makeActions(u)));
      sections.push(b);
    };
    section("Requests", incoming, (u) => [button("Accept", () => act("accept", u.name)), button("Decline", () => act("decline", u.name))], "no requests.");
    section("Friends", friends, (u) => [messageLink(u.name), button("Remove", () => act("remove", u.name))], "no friends yet. find someone below.");
    if (outgoing.length) section("Sent requests", outgoing, (u) => [button("Cancel", () => act("cancel", u.name))], "");
    holder.replaceChildren(...sections);
  }

  const results = el("div");
  const q = input({ placeholder: "start of a username", maxLength: 20 });
  const searchForm = el("form", "stack");
  const go = el("button", "pill", "Search");
  go.type = "submit";
  searchForm.append(q, go);
  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const { users } = await api("users?q=" + encodeURIComponent(q.value.trim()));
      results.replaceChildren();
      if (!users.length) results.append(el("p", "dim", "nobody found."));
      for (const u of users) {
        const view = Object.assign(el("a", "pill", "View"), { href: "profile.html?u=" + encodeURIComponent(u.name) });
        results.append(memberRow(u, view));
      }
    } catch (error) {
      msg.textContent = error.message;
    }
  });

  app.replaceChildren(holder, box("Find people", searchForm, results, msg));
  await draw().catch((error) => (msg.textContent = error.message));
}

// ---------- messages ----------
async function initMessages(me) {
  if (!(await needLogin(me))) return;
  const other = params.get("with");
  if (other && USER_OK.test(other)) return openConversation(other);

  const { conversations } = await api("dm");
  const b = box("Messages");
  if (!conversations.length) b.append(el("p", "dim", "no conversations yet. message one of your friends."));
  for (const c of conversations) {
    const open = Object.assign(el("a", "pill", c.unread ? "Open (new)" : "Open"), { href: "messages.html?with=" + encodeURIComponent(c.name) });
    b.append(memberRow(c, open));
  }
  const friendsLink = Object.assign(el("a", "pill", "Friends list"), { href: "friends.html" });
  app.replaceChildren(b, box("", friendsLink));
}

async function openConversation(otherName) {
  const log = el("div", "thread-list dm-log");
  const msg = notice();
  const title = el("h2", "", "Messages");
  const form = el("form", "thread-form");
  const text = el("textarea");
  text.maxLength = 1000;
  text.rows = 2;
  text.placeholder = "write a message...";
  text.setAttribute("aria-label", "Message");
  const send = el("button", "pill", "Send");
  send.type = "submit";
  form.append(text, send);
  const back = Object.assign(el("a", "pill", "All messages"), { href: "messages.html" });
  app.replaceChildren(box("", title, log, msg, form), box("", back));

  let count = -1;
  let mark = true;
  async function load() {
    try {
      const data = await api("dm?with=" + encodeURIComponent(otherName) + (mark ? "&mark=1" : ""));
      mark = false;
      title.replaceChildren("Chat with ", nameTag(data.with.name, data.with.color));
      form.hidden = !data.friends;
      if (!data.friends) msg.textContent = "you're not friends any more, so you can't send messages.";
      if (data.messages.length === count) return;
      count = data.messages.length;
      log.replaceChildren();
      if (!count) log.append(el("p", "dim", "say hi."));
      for (const m of data.messages) {
        const row = el("div", "msg" + (m.mine ? " mine" : ""));
        const when = new Date(m.ts).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
        row.append(el("div", "msg-head dim", (m.mine ? "you" : data.with.name) + " · " + when), el("p", "msg-text", m.text));
        log.append(row);
      }
      log.scrollTop = log.scrollHeight;
      mark = true;
    } catch (error) {
      msg.textContent = error.message;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!text.value.trim()) return;
    send.disabled = true;
    try {
      await api("dm", { to: otherName, text: text.value });
      text.value = "";
      msg.textContent = "";
      await load();
    } catch (error) {
      msg.textContent = error.message;
    }
    send.disabled = false;
  });

  await load();
  setInterval(() => !document.hidden && load(), 4000);
}

// ---------- forum ----------
const link = (href, label, cls = "") => Object.assign(el("a", cls, label), { href });
const when = (ts) => new Date(ts).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

async function initForum(me) {
  const b = params.get("b");
  const t = params.get("t");
  try {
    if (b && t) return await forumThread(me, b, t);
    if (b) return await forumBoard(me, b);
    const { boards } = await api("forum");
    const list = box("Forum");
    list.append(el("p", "dim", "talk about the world, share art, say hi. you need an account to post."));
    for (const x of boards) {
      const row = el("div", "member");
      const info = el("div", "member-info");
      info.append(link(`forum.html?b=${x.id}`, x.name, "user-link"), el("div", "dim", x.desc));
      row.append(info, el("span", "dim", x.threads + " threads"));
      list.append(row);
    }
    app.replaceChildren(list);
  } catch (error) {
    app.replaceChildren(box("Forum", el("p", "", error.message)));
  }
}

async function forumBoard(me, b) {
  const [{ boards }, data] = await Promise.all([api("forum"), api("forum?board=" + encodeURIComponent(b))]);
  const info = boards.find((x) => x.id === b);
  const list = box(info ? info.name : "Forum", link("forum.html", "← all boards", "pill"));
  if (!data.threads.length) list.append(el("p", "dim", "no threads yet. start one."));
  for (const th of data.threads) {
    const row = el("div", "member");
    const main = el("div", "member-info");
    main.append(link(`forum.html?b=${b}&t=${th.id}`, th.title, "user-link"));
    const by = el("div", "dim");
    by.append("by ", nameTag(th.author, th.color, th.owner), " · " + when(th.ts));
    main.append(by);
    row.append(main, el("span", "dim", th.replies + " replies"));
    list.append(row);
  }

  const form = el("form", "stack");
  const msg = notice();
  const title = input({ maxLength: 80, placeholder: "title", required: true });
  const text = el("textarea");
  text.maxLength = 3000;
  text.rows = 6;
  text.placeholder = "write your post...";
  const go = el("button", "pill", "Publish");
  go.type = "submit";
  form.append(title, text, go, msg);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    go.disabled = true;
    try {
      const { id } = await api("forum", { action: "thread", board: b, title: title.value, text: text.value });
      location.href = `forum.html?b=${b}&t=${id}`;
    } catch (error) {
      msg.textContent = error.message;
      go.disabled = false;
    }
  });
  const compose = me.user ? box("New thread", form) : box("New thread", el("p", "", "sign in to post. "), link("account.html", "Sign in / Join", "pill"));
  app.replaceChildren(list, compose);
}

async function forumThread(me, b, t) {
  const data = await api(`forum?board=${encodeURIComponent(b)}&thread=${encodeURIComponent(t)}`);
  const canDelete = (p) => data.me && (data.me.owner || data.me.user === p.authorKey);

  const post = (p, isThread) => {
    const card = el("div", "forum-post");
    const head = el("div", "msg-head");
    head.append(nameTag(p.author, p.color, p.owner), el("span", "dim", " · " + when(p.ts)));
    card.append(head, el("p", "msg-text", p.text));
    if (canDelete(p)) {
      card.append(button("Delete", async () => {
        if (!confirm(isThread ? "Delete this whole thread?" : "Delete this reply?")) return;
        try {
          await api("forum", { action: "delete", board: b, thread: t, reply: isThread ? undefined : p.id });
          if (isThread) location.href = "forum.html?b=" + b;
          else initForum(me);
        } catch (error) {
          alert(error.message);
        }
      }));
    }
    return card;
  };

  const main = box(data.thread.title, link(`forum.html?b=${b}`, "← back to board", "pill"), post(data.thread, true));
  const replies = box("Replies");
  if (!data.replies.length) replies.append(el("p", "dim", "no replies yet."));
  for (const r of data.replies) replies.append(post(r, false));

  const form = el("form", "stack");
  const msg = notice();
  const text = el("textarea");
  text.maxLength = 2000;
  text.rows = 4;
  text.placeholder = "write a reply...";
  const go = el("button", "pill", "Reply");
  go.type = "submit";
  form.append(text, go, msg);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    go.disabled = true;
    try {
      await api("forum", { action: "reply", board: b, thread: t, text: text.value });
      await initForum(me);
    } catch (error) {
      msg.textContent = error.message;
      go.disabled = false;
    }
  });
  const compose = me.user ? box("Reply", form) : box("Reply", el("p", "", "sign in to reply. "), link("account.html", "Sign in / Join", "pill"));
  app.replaceChildren(main, replies, compose);
}

const PAGE_INIT = { account: initAccount, profile: initProfile, friends: initFriends, messages: initMessages, forum: initForum };
if (app && PAGE_INIT[page]) meReady.then((me) => PAGE_INIT[page](me));
