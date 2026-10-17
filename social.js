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
function resizeImage(file, size = 128, square = true) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (square) {
        const s = Math.min(img.width, img.height);
        canvas.width = canvas.height = size;
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      } else {
        const scale = Math.min(1, size / Math.max(img.width, img.height));
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
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

const PREF_KEY = "sn_prefs";
const readPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY)) || {};
  } catch {
    return {};
  }
};

function checkbox(label, checked, onChange) {
  const wrap = el("label", "inline");
  const c = input({ type: "checkbox", checked });
  c.addEventListener("change", () => onChange(c.checked));
  wrap.append(c, " " + label);
  return wrap;
}

function settingsBox(user) {
  const msg = notice();
  const s = { noRequests: Boolean(user.settings?.noRequests), hidden: Boolean(user.settings?.hidden) };
  const save = async () => {
    try {
      await api("auth", { action: "update", settings: s });
      msg.textContent = "saved.";
    } catch (error) {
      msg.textContent = error.message;
    }
  };
  const prefs = readPrefs();
  const setPref = (key, value) => {
    prefs[key] = value;
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    applyPrefs();
  };
  const size = el("select");
  for (const [v, l] of [["", "normal"], ["large", "large"], ["xlarge", "extra large"]]) size.append(new Option(l, v, false, (prefs.size || "") === v));
  size.addEventListener("change", () => setPref("size", size.value));

  const wrap = el("div", "stack");
  wrap.append(
    el("h3", "", "Privacy"),
    checkbox("don't let people find me in search", s.hidden, (v) => ((s.hidden = v), save())),
    checkbox("don't accept new friend requests", s.noRequests, (v) => ((s.noRequests = v), save())),
    el("h3", "", "On this device"),
    field("Text size", size),
    checkbox("calm mode (stop the scrolling strip and ticker)", Boolean(prefs.calm), (v) => setPref("calm", v)),
    checkbox("hide the stamps in the sidebar", Boolean(prefs.nostamps), (v) => setPref("nostamps", v)),
    msg
  );
  return box("Settings", wrap);
}

function dangerBox() {
  const msg = notice();
  const pw = input({ type: "password", autocomplete: "current-password", placeholder: "your password" });
  const go = button("Delete my account", async () => {
    if (!confirm("Delete your account for good? Your forum posts stay, but your profile, friends list and login are gone.")) return;
    try {
      await api("auth", { action: "deleteAccount", password: pw.value });
      location.href = "index.html";
    } catch (error) {
      msg.textContent = error.message;
    }
  });
  return box("Delete account", el("p", "dim", "this can't be undone."), field("Confirm with password", pw), go, msg);
}

// Owner-only: lives on the account page, every call is re-checked on the server.
function ownerPanel() {
  const holder = box("Owner panel");
  const list = el("div", "stack");
  const msg = notice();
  const filter = input({ placeholder: "filter by name" });
  let users = [];

  const act = async (body) => {
    try {
      await api("admin", body);
      await load();
    } catch (error) {
      msg.textContent = error.message;
    }
  };

  const editor = (u) => {
    const form = el("form", "stack");
    const f = {
      mood: input({ value: u.mood, maxLength: 30 }), pronouns: input({ value: u.pronouns, maxLength: 30 }),
      quote: input({ value: u.quote, maxLength: 120 }), color: input({ type: "color", value: u.color }),
      newPassword: input({ type: "text", placeholder: "leave empty to keep", maxLength: 100 }),
    };
    const bio = el("textarea");
    bio.rows = 3;
    bio.maxLength = 500;
    bio.value = u.bio;
    const rm = input({ type: "checkbox" });
    const rmLabel = el("label", "inline");
    rmLabel.append(rm, " remove their uploaded picture");
    form.append(field("Mood", f.mood), field("Pronouns", f.pronouns), field("Quote", f.quote), field("Bio", bio),
      field("Name colour", f.color), field("Set new password", f.newPassword), rmLabel);
    const go = el("button", "pill", "Save changes");
    go.type = "submit";
    form.append(go);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const body = { action: "edit", name: u.name, mood: f.mood.value, pronouns: f.pronouns.value, quote: f.quote.value, bio: bio.value, color: f.color.value, removePfp: rm.checked };
      if (f.newPassword.value) body.newPassword = f.newPassword.value;
      act(body);
    });
    return form;
  };

  const render = () => {
    const q = filter.value.trim().toLowerCase();
    list.replaceChildren(
      ...users.filter((u) => u.name.toLowerCase().includes(q)).map((u) => {
        const actions = [Object.assign(el("a", "pill", "Profile"), { href: "profile.html?u=" + encodeURIComponent(u.name) })];
        const details = el("details");
        details.append(el("summary", "", "edit"), editor(u));
        if (!u.owner) {
          actions.push(button(u.banned ? "Unban" : "Ban", () => act({ action: u.banned ? "unban" : "ban", name: u.name })));
          actions.push(button("Delete", async () => {
            if (confirm(`Delete ${u.name}'s account for good?`)) await act({ action: "delete", name: u.name });
          }));
        }
        const row = memberRow(u, ...actions);
        if (u.banned) row.querySelector(".member-info").append(el("span", "dim", " [banned]"));
        const wrap = el("div");
        wrap.append(row);
        if (!u.owner) wrap.append(details);
        return wrap;
      })
    );
  };

  async function load() {
    try {
      users = (await api("admin")).users;
      msg.textContent = users.length + " accounts";
      render();
    } catch (error) {
      msg.textContent = error.message;
    }
  }
  filter.addEventListener("input", render);
  holder.append(el("p", "dim", "see, edit, ban or delete any account. only you can see this."), filter, msg, list);
  load();
  return holder;
}

async function initAccount(me) {
  if (me.user) {
    const boxes = [...accountEditor(me.user), settingsBox(me.user)];
    boxes.push(me.user.owner ? ownerPanel() : dangerBox());
    app.replaceChildren(...boxes);
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
const MEDIA_OK = /^\d{13}-[a-z0-9]{6}\.(png|jpg|webp|mp4|webm)$/;
const YT = /(?:youtube\.com\/watch\?(?:[^\s]*&)?v=|youtu\.be\/)([\w-]{11})/;

// Attachment picker: turns the chosen files into uploaded media ids at submit time.
function mediaPicker() {
  const wrap = el("div", "stack");
  const file = input({ type: "file", multiple: true, accept: "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" });
  const note = el("p", "dim", "up to 4 attachments: images, or mp4/webm videos up to 3 MB. for longer videos, paste a youtube link in your text.");
  const chosen = el("p", "dim");
  wrap.append(file, note, chosen);
  const refresh = () => (chosen.textContent = file.files.length ? [...file.files].map((f) => f.name).join(", ") : "");
  file.addEventListener("change", () => {
    if (file.files.length > 4) {
      file.value = "";
      note.textContent = "max 4 attachments, pick again.";
    }
    refresh();
  });
  const upload = async (f) => {
    let blob = f;
    if (f.type.startsWith("image/")) {
      blob = null;
      for (const size of [1280, 900, 600]) {
        const out = await resizeImage(f, size, false);
        if (out.size <= 1400000) {
          blob = out;
          break;
        }
      }
      if (!blob) throw new Error(f.name + " is too big");
    } else if (!["video/mp4", "video/webm"].includes(f.type)) {
      throw new Error(f.name + " isn't a supported file");
    } else if (f.size > 3000000) {
      throw new Error(f.name + " is over 3 MB, paste a youtube link instead");
    }
    const { id } = await api("media", { type: blob.type, data: await toBase64(blob) });
    return id;
  };
  wrap.collect = async () => {
    const ids = [];
    for (const f of file.files) ids.push(await upload(f));
    return ids;
  };
  wrap.reset = () => {
    file.value = "";
    refresh();
  };
  return wrap;
}

function mediaView(ids) {
  const row = el("div", "attachments");
  for (const id of ids || []) {
    if (!MEDIA_OK.test(id)) continue;
    const src = "/api/media?id=" + id;
    if (/\.(mp4|webm)$/.test(id)) {
      const v = el("video");
      v.src = src;
      v.controls = true;
      v.preload = "metadata";
      v.playsInline = true;
      row.append(v);
    } else {
      const a = Object.assign(el("a"), { href: src, target: "_blank", rel: "noopener" });
      const i = el("img");
      i.src = src;
      i.alt = "attachment";
      i.loading = "lazy";
      a.append(i);
      row.append(a);
    }
  }
  return row;
}

function youtubeEmbeds(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text).matchAll(new RegExp(YT.source, "g"))) {
    if (seen.has(m[1]) || seen.size >= 2) continue;
    seen.add(m[1]);
    const f = el("iframe", "yt");
    f.src = "https://www.youtube-nocookie.com/embed/" + m[1];
    f.allowFullscreen = true;
    f.loading = "lazy";
    f.referrerPolicy = "no-referrer";
    f.title = "youtube video";
    out.push(f);
  }
  return out;
}

async function initForum(me) {
  const b = params.get("b");
  const t = params.get("t");
  try {
    if (b && t) return await forumThread(me, b, t);
    return await forumFeed(me, b || "all");
  } catch (error) {
    app.replaceChildren(box("Forum", el("p", "", error.message)));
  }
}

// One post (thread or reply) as a card; shared by the feed and the thread page.
function postCard(p, ctx) {
  const card = el("div", "forum-post");
  const head = el("div", "msg-head");
  head.append(nameTag(p.author, p.color, p.owner), el("span", "dim", " · " + when(p.ts)));
  card.append(head, el("p", "msg-text", p.text), mediaView(p.media), ...youtubeEmbeds(p.text));
  if (ctx.me && (ctx.me.owner || ctx.me.user === p.authorKey)) {
    card.append(button("Delete", async () => {
      if (!confirm(ctx.isThread ? "Delete this whole thread?" : "Delete this reply?")) return;
      try {
        await api("forum", { action: "delete", board: ctx.board, thread: ctx.thread, reply: ctx.isThread ? undefined : p.id });
        if (ctx.isThread && ctx.single) location.href = "forum.html?b=" + ctx.board;
        else ctx.refresh();
      } catch (error) {
        alert(error.message);
      }
    }));
  }
  return card;
}

async function forumFeed(me, b) {
  const [{ boards }, data] = await Promise.all([api("forum"), api("forum?board=" + encodeURIComponent(b))]);
  const names = new Map(boards.map((x) => [x.id, x.name]));
  const refresh = () => initForum(me);

  const nav = el("p", "small-links");
  for (const [id, label] of [["all", "All"], ...boards.map((x) => [x.id, `${x.name} (${x.threads})`])]) {
    const a = link(id === "all" ? "forum.html" : `forum.html?b=${id}`, label, "pill" + (id === b ? " on" : ""));
    nav.append(a, " ");
  }
  const feed = box(b === "all" ? "Forum" : names.get(b) || "Forum", nav);
  if (b === "all") feed.append(el("p", "dim", "talk about the world, share art, say hi. scroll to read everything, open a thread to reply."));
  else feed.append(el("p", "dim", boards.find((x) => x.id === b)?.desc || ""));
  if (!data.threads.length) feed.append(el("p", "dim", "no threads yet. start one."));

  for (const th of data.threads) {
    const card = el("div", "thread-card");
    const open = `forum.html?b=${th.board}&t=${th.id}`;
    const title = el("h3", "thread-title");
    title.append(link(open, th.title, "user-link"));
    if (b === "all") title.append(" ", el("span", "dim", "in " + (names.get(th.board) || th.board)));
    card.append(title);
    const ctx = { me: data.me, board: th.board, thread: th.id, refresh };
    card.append(postCard(th, { ...ctx, isThread: true }));
    const hidden = th.replies - th.recent.length;
    if (hidden > 0) card.append(link(open, `${hidden} earlier ${hidden === 1 ? "reply" : "replies"} ›`, "dim"));
    for (const r of th.recent) card.append(postCard(r, { ...ctx, isThread: false }));
    card.append(link(open, th.replies ? `${th.replies} replies · open to reply` : "open to reply", "pill"));
    feed.append(card);
  }

  const form = el("form", "stack");
  const msg = notice();
  const boardPick = el("select");
  for (const x of boards) boardPick.append(new Option(x.name, x.id, false, x.id === (b === "all" ? "general" : b)));
  const title = input({ maxLength: 80, placeholder: "title", required: true });
  const text = el("textarea");
  text.maxLength = 3000;
  text.rows = 6;
  text.placeholder = "write your post... (paste a youtube link to embed it)";
  const picker = mediaPicker();
  const go = el("button", "pill", "Publish");
  go.type = "submit";
  form.append(boardPick, title, text, picker, go, msg);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    go.disabled = true;
    msg.textContent = "publishing...";
    try {
      const media = await picker.collect();
      const { id } = await api("forum", { action: "thread", board: boardPick.value, title: title.value, text: text.value, media });
      location.href = `forum.html?b=${boardPick.value}&t=${id}`;
    } catch (error) {
      msg.textContent = error.message;
      go.disabled = false;
    }
  });
  const compose = box("New post");
  if (me.user) {
    const d = el("details");
    d.append(el("summary", "", "✠ write a new post"), form);
    compose.append(d);
  } else {
    compose.append(el("p", "", "sign in to post. "), link("account.html", "Sign in / Join", "pill"));
  }
  app.replaceChildren(compose, feed);
}

async function forumThread(me, b, t) {
  const data = await api(`forum?board=${encodeURIComponent(b)}&thread=${encodeURIComponent(t)}`);
  const ctx = { me: data.me, board: b, thread: t, refresh: () => initForum(me) };
  const post = (p, isThread) => postCard(p, { ...ctx, isThread, single: true });
  const main = box(data.thread.title, link(`forum.html?b=${b}`, "← back to board", "pill"), post(data.thread, true));
  const replies = box("Replies");
  if (!data.replies.length) replies.append(el("p", "dim", "no replies yet."));
  for (const r of data.replies) replies.append(post(r, false));

  const form = el("form", "stack");
  const msg = notice();
  const text = el("textarea");
  text.maxLength = 2000;
  text.rows = 4;
  text.placeholder = "write a reply... (images, videos and youtube links work too)";
  const picker = mediaPicker();
  const go = el("button", "pill", "Reply");
  go.type = "submit";
  form.append(text, picker, go, msg);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    go.disabled = true;
    msg.textContent = "posting...";
    try {
      const media = await picker.collect();
      await api("forum", { action: "reply", board: b, thread: t, text: text.value, media });
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
