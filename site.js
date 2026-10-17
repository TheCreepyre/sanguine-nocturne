const PAGES = [
  ["index.html", "Home"],
  ["lore.html", "Lore"],
  ["characters.html", "Characters"],
  ["gallery.html", "Gallery"],
  ["chat.html", "Chat"],
  ["about.html", "About me"],
  ["what.html", "What is this"],
  ["stamps.html", "Stamp wall"],
  ["contact.html", "Contact"],
];

// Left column shared by every page: mini profile, menu, counter, stamps.
function buildSidebar(el) {
  const current = location.pathname.split("/").pop() || "index.html";
  const links = PAGES.map(([href, label]) => {
    const here = href === current || (href === "index.html" && !current.includes("."));
    return `<li><a href="${href}"${here ? ' aria-current="page"' : ""}>${label}</a></li>`;
  }).join("");

  el.innerHTML = `
    <div class="box extra">
      <div class="photo-row">
        <img class="photo" src="assets/pfp.jpg" alt="Herr Myrden profile picture">
        <div>
          <b class="name-small">Herr Myrden</b>
          <p class="online">          &#9679; mrrlem!</p>
                    <p class="dim">"do not fear me, as i fear myself more"</p>
        </div>
      </div>
      <p class="mood">Mood: <b>(tired)</b></p>
      <p class="small-links"><a href="about.html">about the artist</a></p>
    </div>
    <div class="box">
      <h2>Menu</h2>
      <ul id="menu">${links}</ul>
    </div>
    <div class="box">
      <h2>Visitors</h2>
      <span class="counter" id="counter" aria-label="Visitor counter">------</span>
    </div>
    <div class="box extra">
      <h2>Stamps</h2>
      <div class="stamps">
        <img src="assets/b-07.png" alt="Yes I sleep in a coffin">
        <img src="assets/b-22.png" alt="Fallen angel">
        <img src="assets/b-13.png" alt="Bite me">
        <img src="assets/b-15.png" alt="Night person">
        <a href="stamps.html">more...</a>
      </div>
    </div>
    <div class="box dance">
      <h2>Creatures</h2>
      <div class="dance-grid">${danceIcons()}</div>
    </div>`;
}

// Bigger animated icons to fill the left column; long pages get more.
function danceIcons() {
  const long = ["characters.html", "lore.html", "gallery.html", "chat.html"].includes(location.pathname.split("/").pop());
  const count = long ? (location.pathname.endsWith("characters.html") ? 36 : 16) : 6;
  const picks = [1, 4, 5, 7, 9, 12, 15, 18, 19, 21, 2, 6, 10, 14, 17, 22, 3, 8, 11, 13, 16, 20, 23];
  return Array.from({ length: count }, (_, i) => picks[i % picks.length]).map(n => {
    const id = String(n).padStart(2, "0");
    const ext = [15, 18, 19].includes(n) ? "webp" : "png";
    return `<img src="assets/fx-${id}.${ext}" alt="">`;
  }).join("");
}

async function runCounter() {
  const counter = document.getElementById("counter");
  const label = document.getElementById("visitor-number");
  if (!counter) return;
  try {
    // Only record one visit per browser session; other pages just read the count.
    const firstVisit = !sessionStorage.getItem("visited");
    const res = await fetch("/api/visits", { method: firstVisit ? "POST" : "GET" });
    if (!res.ok) throw new Error(res.status);
    const { count } = await res.json();
    sessionStorage.setItem("visited", "1");
    counter.textContent = String(count).padStart(6, "0");
    if (label) label.textContent = "#" + count;
  } catch {
    counter.textContent = "??????";
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Comment / chat widget. Everything user-written goes in through textContent.
function initThread(host) {
  const thread = host.dataset.thread;
  const poll = Number(host.dataset.poll) || 0;
  const limit = Number(host.dataset.limit) || 30;
  const api = "/api/comments?thread=" + encodeURIComponent(thread);

  const list = el("div", "thread-list");
  list.setAttribute("aria-live", "polite");
  const status = el("p", "thread-status dim");

  const form = el("form", "thread-form");
  const name = el("input");
  name.name = "name";
  name.maxLength = 24;
  name.placeholder = "name (optional)";
  name.autocomplete = "nickname";
  name.value = localStorage.getItem("chatName") || "";
  name.setAttribute("aria-label", "Your name");

  const text = el("textarea");
  text.name = "text";
  text.maxLength = 500;
  text.rows = host.dataset.rows || 2;
  text.placeholder = host.dataset.placeholder || "say something...";
  text.setAttribute("aria-label", "Your message");

  // Honeypot: hidden from people, filled in by bots.
  const trap = el("input", "trap");
  trap.name = "website";
  trap.tabIndex = -1;
  trap.autocomplete = "off";
  trap.setAttribute("aria-hidden", "true");

  const send = el("button", "pill", "Post");
  send.type = "submit";
  form.append(name, text, trap, send);
  host.append(list, status, form);

  let lastCount = -1;

  function render(messages) {
    const pinned = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
    list.replaceChildren();
    if (!messages.length) list.append(el("p", "dim", host.dataset.empty || "nothing here yet. be first."));
    for (const m of messages) {
      const row = el("div", "msg");
      const head = el("div", "msg-head");
      head.append(el("b", "label", m.name));
      const when = new Date(m.ts);
      head.append(el("span", "dim", " " + when.toLocaleString([], { dateStyle: "short", timeStyle: "short" })));
      row.append(head, el("p", "msg-text", m.text));
      list.append(row);
    }
    if (host.dataset.stick !== undefined && (pinned || lastCount < 0)) list.scrollTop = list.scrollHeight;
    lastCount = messages.length;
  }

  async function load() {
    try {
      const res = await fetch(`${api}&limit=${limit}`);
      if (!res.ok) throw new Error(res.status);
      const { messages } = await res.json();
      render(messages);
      status.textContent = "";
    } catch {
      list.replaceChildren(el("p", "dim", "can't reach the server right now. this only works once the site is online."));
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!text.value.trim()) return;
    send.disabled = true;
    status.textContent = "sending...";
    localStorage.setItem("chatName", name.value.trim());
    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.value, text: text.value, website: trap.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "could not post");
      text.value = "";
      status.textContent = "";
      await load();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      send.disabled = false;
    }
  });

  let started = false;
  function start() {
    if (started) return;
    started = true;
    load();
    if (poll) setInterval(() => !document.hidden && load(), poll);
  }

  // Threads inside a closed <details> only load when it's opened.
  const details = host.closest("details");
  if (details && !details.open) details.addEventListener("toggle", start, { once: true });
  else start();
}

// Icon strip: 3 identical sets so a loop of exactly one set is seamless.
const track = document.querySelector(".dancer-track");
const tickerTrack = document.querySelector(".ticker-track");
if (track) {
  const fx = Array.from({ length: 23 }, (_, n) => "fx-" + String(n + 1).padStart(2, "0") + ([15, 18, 19].includes(n + 1) ? ".webp" : ".png"));
  for (let i = 0; i < 3; i++) {
    for (const file of fx) {
      const img = el("img", "dancer-gif");
      img.src = "assets/" + file;
      img.alt = "";
      track.append(img);
    }
  }
}

if (tickerTrack) {
  const first = tickerTrack.firstElementChild;
  for (let i = 0; i < 2; i++) tickerTrack.append(first.cloneNode(true));
}

// Both strips move at the same pixels-per-second, whatever their width.
const SPEED = 130;
function syncSpeed(strip) {
  if (!strip) return;
  const dist = strip.scrollWidth / 3;
  if (!dist) return;
  strip.style.setProperty("--dist", dist + "px");
  strip.style.setProperty("--dur", dist / SPEED + "s");
}
function syncStrips() {
  syncSpeed(track);
  syncSpeed(tickerTrack);
}
if (track || tickerTrack) {
  syncStrips();
  window.addEventListener("load", syncStrips);
  if (document.fonts) document.fonts.ready.then(syncStrips);
}

const side = document.getElementById("left");
if (side) buildSidebar(side);
runCounter();
document.querySelectorAll(".thread").forEach(initThread);
