/* vid — frontend (vanilla JS): routing hash, skeletoane, toast-uri, episoade, TorrServer */
"use strict";

/* ================= util ================= */
const $ = (sel) => document.querySelector(sel);
const content = $("#content");
const searchOverlay = $("#search-overlay");

let state = {
  watchlist: new Set(),
  wlStatus: {}, // id -> "to_watch"|"watching"|"watched"
  history: [],
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    showLogin();
    throw new Error("Autentificare necesară");
  }
  if (!res.ok) {
    let detail = res.status;
    try {
      const j = await res.json();
      detail = j.detail || detail;
    } catch (_) {}
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json();
}

/* ---------- login (când portalul e publicat cu parolă) ---------- */
function showLogin() {
  const ov = $("#login-overlay");
  if (!ov || !ov.classList.contains("hidden")) return;
  ov.classList.remove("hidden");
  $("#login-pass").focus();
}
async function tryLogin() {
  const pass = $("#login-pass").value;
  const err = $("#login-err");
  err.classList.add("hidden");
  try {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pass }),
    });
    if (r.ok) {
      location.reload();
      return;
    }
    err.textContent = "Parolă greșită";
    err.classList.remove("hidden");
  } catch (_) {
    err.textContent = "Eroare de rețea";
    err.classList.remove("hidden");
  }
}

const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}
const escUrl = esc;
/* URL în style="background-image:url('…')": entitățile HTML se decodează înainte de CSS,
   deci ghilimelele/parantezele se codifică URL (%27 etc.), nu ca entități */
function cssUrl(s) {
  const enc = String(s == null ? "" : s).replace(/['"()\\\s<>]/g, (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"));
  return `url('${esc(enc)}')`;
}
/* card/rând clicabil și de la tastatură (Enter/Space), nu doar cu mouse-ul */
function makeActivatable(el, fn, label) {
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  if (label) el.setAttribute("aria-label", label);
  el.addEventListener("click", fn);
  el.addEventListener("keydown", (e) => {
    if (e.target !== el || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    fn(e);
  });
}
function fmtTime(sec) {
  if (!sec || sec < 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
}
function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ================= toast ================= */
function toast(msg, ok = true) {
  let host = $("#toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = "toast" + (ok ? "" : " error");
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 350);
  }, 2600);
}

/* ================= iconițe SVG ================= */
const I = {
  play: "M8 5v14l11-7z",
  star: "m12 17.3-6.2 3.7 1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.8 1.6 7z",
  check: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z",
  close: "M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z",
  trash: "M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z",
  download: "M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z",
  pip: "M19 11h-8v6h8zm2-8H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H3V5h18z",
  full: "M7 14H5v5h5v-2H7zm0-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2zM14 5v2h3v3h2V5z",
  info: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2zm0-8h-2V7h2z",
  film: "M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4z",
  yt: "M4 4.8h16a3.2 3.2 0 0 1 3.2 3.2v8a3.2 3.2 0 0 1-3.2 3.2H4A3.2 3.2 0 0 1 .8 16V8A3.2 3.2 0 0 1 4 4.8zM10.2 8.7v6.6l5.8-3.3z",
  external: "M14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3zM5 5h5V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-2v5z",
  pause: "M6 5h4v14H6zm8 0h4v14h-4z",
  back10: "M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z",
  fwd10: "M12 5V1l5 5-5 5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z",
  prev: "M6 6h2v12H6zm3.5 6 8.5 6V6z",
  next: "M6 18l8.5-6L6 6zm10-12v12h2V6z",
  vol: "M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z",
  mute: "M3 9v6h4l5 5V4L7 9zm14.6 3 2.4-2.4-1.4-1.4-2.4 2.4-2.4-2.4-1.4 1.4 2.4 2.4-2.4 2.4 1.4 1.4 2.4-2.4 2.4 2.4 1.4-1.4z",
  unfull: "M5 16h3v3h2v-5H5zm3-8H5v2h5V5H8zm6 11h2v-3h3v-2h-5zm2-11V5h-2v5h5V8z",
};
const svg = (p, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" fill-rule="evenodd"><path d="${p}"/></svg>`;

/* ================= skeletoane ================= */
function skelRows(n = 2) {
  let html = "";
  for (let r = 0; r < n; r++) {
    html += `<div class="row"><div class="skel skel-title"></div><div class="row-scroll">`;
    for (let c = 0; c < 8; c++)
      html += `<div class="card"><div class="skel skel-poster"></div><div class="skel skel-line"></div></div>`;
    html += `</div></div>`;
  }
  return html;
}
function skelGrid(n = 12) {
  let html = '<div class="grid">';
  for (let c = 0; c < n; c++)
    html += `<div class="card"><div class="skel skel-poster"></div><div class="skel skel-line"></div></div>`;
  return html + "</div>";
}

/* ================= card + rând ================= */
function cardEl(title, opts = {}) {
  const div = document.createElement("div");
  div.className = "card";
  div.dataset.id = title.id;

  const rating = title.rating ? Number(title.rating).toFixed(1) : null;
  let progress = "";
  if (opts.progress && opts.progress > 0 && opts.duration) {
    const pct = Math.min(100, Math.round((opts.progress / opts.duration) * 100));
    progress = `<div class="card-progress"><i style="width:${pct}%"></i></div>`;
  }

  // sub-rândul: „S2 · E5 · 23 min rămase” la „Continuă”, altfel anul + tipul
  const kind = title.type === "series" ? "· serial" : title.type === "movie" ? "· film" : "";
  const sub = opts.sub || (title.year ? `${title.year} ${kind}` : "");

  div.innerHTML = `
    <div class="card-poster">
      ${title.poster
        ? `<img loading="lazy" decoding="async" alt="" src="${escUrl(title.poster)}">`
        : `<div class="noimg">${esc(title.name)}</div>`}
      ${rating ? `<div class="card-rate ${Number(title.rating) < 5 ? "low" : ""}">${rating}</div>` : ""}
      ${title.source && title.source !== "tmdb" ? `<div class="card-tag">${esc(title.source)}</div>` : ""}
      ${progress}
    </div>
    <div class="card-name">${esc(title.name)}</div>
    ${sub ? `<div class="card-sub${opts.sub && opts.accent !== false ? " accent" : ""}">${esc(sub)}</div>` : ""}
  `;
  makeActivatable(div, () => openDetail(title), title.name);
  return div;
}

/* „S2 · E5 · 23 min rămase” pentru un rând de istoric */
function historyLabel(h) {
  const ep = h.season ? `S${h.season} · E${h.episode} · ` : "";
  const left = Math.max(0, (h.duration_seconds || 0) - (h.position_seconds || 0));
  const mins = Math.round(left / 60);
  return ep + (mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min rămase` : `${Math.max(1, mins)} min rămase`);
}
// început (>30s) dar neterminat (>1 min rămas); un film văzut până la capăt dispare din „Continuă”
const isUnfinished = (h) =>
  h.position_seconds > 30 && (h.duration_seconds == null || h.duration_seconds - h.position_seconds > 60);
const isContinuable = (h) => !!h.title && !!h.duration_seconds && isUnfinished(h);

function rowEl(titleText, titles, opts = {}) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<div class="row-title"><div>${esc(titleText)}</div></div>`;
  const scroll = document.createElement("div");
  scroll.className = "row-scroll";
  titles.forEach((t, i) => {
    const h = opts.histories && opts.histories[i];
    scroll.appendChild(
      cardEl(t, h ? { progress: h.position_seconds, duration: h.duration_seconds, sub: historyLabel(h) } : {})
    );
  });
  if (opts.onMore) {
    const b = document.createElement("button");
    b.className = "row-more";
    b.textContent = "Toate →";
    b.addEventListener("click", opts.onMore);
    row.querySelector(".row-title").appendChild(b);
  }
  // săgeți stânga/dreapta: cu mouse-ul (fără bare de derulare) rândul nu se putea derula
  const track = document.createElement("div");
  track.className = "row-track";
  const arrow = (dir) => {
    const b = document.createElement("button");
    b.className = `row-arrow ${dir < 0 ? "left" : "right"}`;
    b.setAttribute("aria-label", dir < 0 ? "Înapoi" : "Înainte");
    b.tabIndex = -1;
    b.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="${dir < 0 ? "M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z" : "M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"}"/></svg>`;
    b.addEventListener("click", () => scroll.scrollBy({ left: dir * scroll.clientWidth * 0.85, behavior: "smooth" }));
    return b;
  };
  const left = arrow(-1), right = arrow(1);
  const updateArrows = () => {
    left.classList.toggle("off", scroll.scrollLeft <= 4);
    right.classList.toggle("off", scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 4);
  };
  scroll.addEventListener("scroll", updateArrows, { passive: true });
  new ResizeObserver(updateArrows).observe(scroll); // fără listeneri globali care se adună la fiecare randare
  requestAnimationFrame(updateArrows);
  track.append(left, scroll, right);
  row.appendChild(track);
  return row;
}

/* ================= routing (hash) ================= */
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  const seg = h.split("/").filter(Boolean);
  if (!seg.length) return { view: "home" };
  if (seg[0] === "browse") return { view: "browse", category: CATEGORIES[seg[1]] ? seg[1] : "films" };
  if (seg[0] === "title" && /^\d+$/.test(seg[1] || "")) return { view: "title", id: +seg[1] };
  if (seg[0] === "person" && /^\d+$/.test(seg[1] || "")) return { view: "person", id: +seg[1] };
  if (seg[0] === "search") {
    let q = seg.slice(1).join("/");
    try {
      q = decodeURIComponent(q);
    } catch (_) {} // hash scris de mână cu „%” invalid — folosim textul brut
    return { view: "searchpage", q };
  }
  if (seg[0] === "watchlist") return { view: "watchlist" };
  if (seg[0] === "continue") return { view: "continue" };
  if (seg[0] === "downloads") return { view: "downloads" };
  if (seg[0] === "calendar") return { view: "calendar" };
  if (seg[0] === "sport") return { view: "sport" };
  if (seg[0] === "live") return { view: "live" };
  if (seg[0] === "torrents") {
    let q = seg.slice(1).join("/");
    try {
      q = decodeURIComponent(q);
    } catch (_) {}
    return { view: "torrents", q };
  }
  return { view: "home" };
}
function go(hash) {
  if (location.hash === hash) {
    forceRender = true; // clic pe pagina curentă din meniu = reîncărcare
    render();
  }
  else location.hash = hash;
}

/* categoriile din meniu: discover cu filtre; listele (trend etc.) nu au filtre */
const CATEGORIES = {
  films: { title: "Filme", filters: true },
  series: { title: "Seriale", filters: true },
  cartoons: { title: "Desene animate", filters: true },
  anime: { title: "Anime", filters: true },
  now_playing: { title: "Acum în cinematografe", filters: false },
  trending_day: { title: "În trend azi", filters: false },
  trending_week: { title: "În trend săptămâna aceasta", filters: false },
};
window.addEventListener("hashchange", render);

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    const v = btn.dataset.view;
    if (v === "search") {
      openSearch();
      return;
    }
    go(v === "home" ? "#/" : CATEGORIES[v] ? `#/browse/${v}` : `#/${v}`);
  });
});

function setNavActive(view) {
  document.querySelectorAll(".nav-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view)
  );
}

/* fiecare navigare primește un număr; un loader care termină după ce ai plecat
   în altă pagină vede că numărul s-a schimbat și nu mai desenează nimic */
let viewSeq = 0;

/* pagina filmului are adresă proprie (#/title/123): butonul Înapoi al browserului merge,
   iar linkul se poate trimite. Pagina de dedesubt (pageHash) rămâne încărcată, cu scroll-ul ei.
   detailDepth = câte pagini de film am deschis noi la rând (titlu -> similar -> ...),
   ca „Închide” să revină direct la pagina de dedesubt. */
let pageHash = null;
let detailDepth = 0;
let navFromApp = false;
let forceRender = false;

function openDetail(title) {
  const hash = `#/title/${title.id}`;
  if (location.hash === hash) return; // deja deschis
  navFromApp = true;
  location.hash = hash;
}
/* butonul ✕ / Escape / clic în afară */
function leaveDetail() {
  if (detailDepth > 0) {
    const n = detailDepth;
    detailDepth = 0;
    history.go(-n);
  } else {
    location.hash = pageHash || "#/";
  }
}

async function render() {
  const r = parseRoute();
  closeSearch();

  if (r.view === "title") {
    // după Înapoi/Înainte din browser nu mai știm sigur câte filme sunt deasupra paginii
    // de dedesubt (-1): „Închide” sare atunci direct la ea, în loc de history.go(-n)
    if (navFromApp) detailDepth = detailDepth >= 0 ? detailDepth + 1 : -1;
    else detailDepth = -1;
    navFromApp = false;
    forceRender = false;
    if (pageHash === null) {
      // link direct spre un film: încărcăm acasă dedesubt
      pageHash = "#/";
      viewSeq++;
      setNavActive("home");
      loadHome();
    }
    showDetail(r.id);
    return;
  }

  navFromApp = false;
  detailDepth = 0;
  closeDetail();
  const hash = location.hash || "#/";
  // înapoi din pagina filmului: pagina de dedesubt e deja încărcată — o păstrăm, cu scroll
  if (hash === pageHash && content.childElementCount && !forceRender) return;
  forceRender = false;
  pageHash = hash;

  viewSeq++;
  const navView = r.view === "browse" ? r.category : r.view === "searchpage" || r.view === "person" ? null : r.view;
  setNavActive(navView);
  window.scrollTo(0, 0);

  if (r.view === "home") return loadHome();
  if (r.view === "person") return loadPerson(r.id);
  if (r.view === "browse") return loadBrowse(r.category);
  if (r.view === "searchpage") return loadSearchPage(r.q);
  if (r.view === "watchlist") return loadWatchlist();
  if (r.view === "continue") return loadContinue();
  if (r.view === "downloads") return loadDownloads();
  if (r.view === "calendar") return loadCalendar();
  if (r.view === "sport") return loadSport();
  if (r.view === "live") return loadLive();
  if (r.view === "torrents") return loadTorrentSearch(r.q);
  return loadHome();
}

/* ================= HOME ================= */
/* rândurile paginii principale, în ordine (ca în Lampa); se încarcă în paralel și apar
   fiecare când sosește, fără să aștepte după cel mai lent */
const HOME_ROWS = [
  { key: "now_playing", title: "Acum în cinematografe" },
  { key: "films", title: "Filme populare" },
  { key: "series", title: "Seriale populare" },
  { key: "trending_week", title: "În trend săptămâna aceasta" },
  { key: "cartoons", title: "Desene animate" },
  { key: "anime", title: "Anime" },
];

async function loadHome() {
  const seq = viewSeq;
  content.innerHTML = `<div class="hero-skel skel"></div><div class="rows">${skelRows(2)}</div>`;
  const fetchList = (key) => api(`/api/browse?category=${key}`).then((d) => d.results || []);
  // pornim toate cererile deodată; hero-ul așteaptă doar „În trend azi”
  const pending = Object.fromEntries(HOME_ROWS.map((r) => [r.key, fetchList(r.key)]));
  Object.values(pending).forEach((p) => p.catch(() => {})); // erorile se tratează pe rând
  let trending;
  try {
    [trending, state.history] = await Promise.all([
      fetchList("trending_day"),
      api("/api/history").catch(() => state.history),
    ]);
  } catch (err) {
    if (seq !== viewSeq) return;
    content.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}<br><button class="btn ghost" style="margin-top:1rem" onclick="location.reload()">Reîncearcă</button></div>`;
    return;
  }
  if (seq !== viewSeq) return;

  content.innerHTML = "";

  const heroTitle = trending.find((t) => t.poster) || trending[0];
  if (heroTitle) {
    const kind = heroTitle.type === "series" ? "serial" : "film";
    const hero = document.createElement("section");
    hero.className = "hero";
    hero.innerHTML = `
      <div class="hero-backdrop" style="background-image:${cssUrl(heroTitle.poster)}"></div>
      <div class="hero-inner">
        <div class="hero-poster">${heroTitle.poster ? `<img alt="" fetchpriority="high" src="${escUrl(heroTitle.poster)}">` : ""}</div>
        <div class="hero-info">
          <div class="hero-kicker">În trend azi</div>
          <div class="hero-title">${esc(heroTitle.name)}</div>
          <div class="hero-meta">
            ${heroTitle.rating ? `<span class="stars">★ ${Number(heroTitle.rating).toFixed(1)}</span>` : ""}
            ${heroTitle.year ? `<span>${esc(heroTitle.year)}</span>` : ""}
            <span>${kind}</span>
          </div>
          <div class="hero-desc" id="hero-desc"></div>
          <div class="hero-actions">
            <button class="btn" id="hero-play">${svg(I.play)} Vizionează</button>
            <button class="btn ghost" id="hero-wl">${svg(I.star, 16)} ${state.watchlist.has(heroTitle.id) ? "În watchlist" : "Watchlist"}</button>
          </div>
        </div>
      </div>
    `;
    content.appendChild(hero);
    hero.querySelector("#hero-play").addEventListener("click", () => openDetail(heroTitle));
    hero.querySelector(".hero-poster").addEventListener("click", () => openDetail(heroTitle));
    hero.querySelector("#hero-wl").addEventListener("click", async () => {
      try {
        const on = await toggleWatchlist(heroTitle);
        hero.querySelector("#hero-wl").innerHTML = `${svg(I.star, 16)} ${on ? "În watchlist" : "Watchlist"}`;
      } catch (err) {
        toast(err.message, false);
      }
    });
    enrichHero(hero, heroTitle, seq);
  }

  const rows = document.createElement("div");
  rows.className = "rows";
  content.appendChild(rows);

  const continuable = state.history.filter(isContinuable);
  if (continuable.length) {
    rows.appendChild(
      rowEl("Continuă vizionarea", continuable.map((h) => h.title), { histories: continuable })
    );
  }
  rows.appendChild(
    rowEl("În trend azi", trending.filter((t) => t !== heroTitle), { onMore: () => go("#/browse/trending_day") })
  );

  // un loc rezervat (schelet) pentru fiecare rând, înlocuit când îi sosesc datele
  for (const r of HOME_ROWS) {
    const slot = document.createElement("div");
    slot.innerHTML = skelRows(1);
    rows.appendChild(slot);
    pending[r.key]
      .then((items) => {
        if (seq !== viewSeq || !slot.isConnected) return;
        if (!items.length) return slot.remove();
        slot.replaceWith(rowEl(r.title, items, { onMore: () => go(`#/browse/${r.key}`) }));
      })
      .catch(() => slot.isConnected && slot.remove()); // un rând căzut nu strică pagina
  }
}

/* hero: după prima afișare (instant, cu posterul estompat) aducem detaliile titlului
   și trecem pe imaginea lată reală + descriere, cu o tranziție lină */
async function enrichHero(hero, title, seq) {
  let d;
  try {
    d = await api(`/api/title/${title.id}`);
  } catch (_) {
    return; // rămâne varianta cu posterul estompat
  }
  if (seq !== viewSeq || !hero.isConnected) return;
  if (d.description) hero.querySelector("#hero-desc").textContent = d.description;
  if (!d.backdrop) return;
  const img = new Image();
  img.onload = () => {
    if (!hero.isConnected) return;
    const layer = document.createElement("div");
    layer.className = "hero-backdrop sharp";
    layer.style.backgroundImage = cssUrl(d.backdrop);
    hero.querySelector(".hero-backdrop").after(layer);
    requestAnimationFrame(() => hero.classList.add("has-backdrop"));
  };
  img.src = d.backdrop;
}

/* ================= BROWSE (cu filtre) ================= */
// seq: crește la fiecare schimbare de filtru/categorie; răspunsurile vechi sunt ignorate
const browseState = { category: "films", page: 1, genre: "", year: "", sort: "popularity", items: [], done: false, loading: false, seq: 0 };

async function loadBrowse(category) {
  const seq = viewSeq;
  Object.assign(browseState, { category, page: 1, genre: "", year: "", sort: "popularity", items: [], done: false, loading: false });
  browseState.seq++;
  const cat = CATEGORIES[category] || CATEGORIES.films;
  content.innerHTML = `
    <div class="grid-wrap">
      <div class="view-title">${esc(cat.title)}</div>
      <div class="filter-bar${cat.filters ? "" : " hidden"}" id="filter-bar">
        <select id="f-genre"><option value="">Gen: toate</option></select>
        <select id="f-year"><option value="">An: toți</option></select>
        <select id="f-sort">
          <option value="popularity">Sortare: popularitate</option>
          <option value="rating">Sortare: rating</option>
          <option value="date">Sortare: mai noi</option>
          <option value="title">Sortare: titlu</option>
        </select>
      </div>
      <div class="grid" id="browse-grid">${skelGrid(12).replace('<div class="grid">', "").replace("</div>", "")}</div>
      <div class="load-more-wrap"><button class="btn ghost" id="load-more">Încarcă mai multe</button></div>
    </div>`;

  const yearSel = $("#f-year");
  const now = new Date().getFullYear();
  for (let y = now + 1; y >= 1950; y--) {
    const o = document.createElement("option");
    o.value = y;
    o.textContent = y;
    yearSel.appendChild(o);
  }

  // filtrele se pot folosi imediat; genurile se completează când sosesc
  const apply = () => {
    browseState.genre = $("#f-genre").value;
    browseState.year = $("#f-year").value;
    browseState.sort = $("#f-sort").value;
    browseState.page = 1;
    browseState.items = [];
    browseState.done = false;
    browseState.loading = false; // cererea anterioară, încă în zbor, devine învechită
    browseState.seq++;
    fetchBrowsePage();
  };
  ["#f-genre", "#f-year", "#f-sort"].forEach((id) => $(id).addEventListener("change", apply));
  $("#load-more").addEventListener("click", fetchBrowsePage);
  fetchBrowsePage();

  if (cat.filters) try {
    const genres = await api(`/api/genres?category=${category}`);
    if (seq !== viewSeq) return;
    const gSel = $("#f-genre");
    genres.forEach((g) => {
      const o = document.createElement("option");
      o.value = g.id;
      o.textContent = g.name;
      gSel.appendChild(o);
    });
  } catch (_) {}
}

async function fetchBrowsePage() {
  if (browseState.loading || browseState.done) return;
  const seq = browseState.seq;
  const stale = () => seq !== browseState.seq || !$("#browse-grid");
  browseState.loading = true;
  const btn = $("#load-more");
  if (btn) btn.disabled = true;
  const first = browseState.page === 1;
  if (first) $("#browse-grid").innerHTML = skelGrid(12).replace('<div class="grid">', "").replace("</div>", "");
  try {
    const p = new URLSearchParams({
      category: browseState.category,
      page: String(browseState.page),
      sort: browseState.sort,
    });
    if (browseState.genre) p.set("genre", browseState.genre);
    if (browseState.year) p.set("year", browseState.year);
    const data = await api(`/api/browse?${p}`);
    if (stale()) return;
    const res = data.results || [];
    if (first) $("#browse-grid").innerHTML = "";
    const grid = $("#browse-grid");
    res.forEach((t) => {
      browseState.items.push(t);
      grid.appendChild(cardEl(t));
    });
    browseState.done = res.length < 20;
    browseState.page++; // doar la succes: o eroare nu mai sare peste o pagină
    if (!browseState.items.length && first)
      grid.innerHTML = `<div class="status">Nimic pentru filtrele alese.</div>`;
  } catch (err) {
    if (stale()) return;
    if (first) {
      $("#browse-grid").innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
      browseState.done = true;
    } else {
      toast(`Nu s-a încărcat pagina următoare: ${err.message}`, false); // butonul rămâne pentru reîncercare
    }
  } finally {
    if (seq === browseState.seq) {
      browseState.loading = false;
      if (btn) {
        btn.disabled = false;
        btn.classList.toggle("hidden", browseState.done);
      }
    }
  }
}

/* ================= WATCHLIST ================= */
const WL_LABELS = { to_watch: "De văzut", watching: "În curs", watched: "Văzut" };

async function loadWatchlist() {
  const seq = viewSeq;
  content.innerHTML = `<div class="grid-wrap"><div class="view-title">Watchlist</div>${skelGrid(6)}</div>`;
  let items;
  try {
    items = await api("/api/watchlist");
  } catch (err) {
    if (seq === viewSeq) content.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
    return;
  }
  if (seq !== viewSeq) return;
  state.watchlist = new Set(items.map((i) => i.title.id));
  items.forEach((i) => (state.wlStatus[i.title.id] = i.status));

  const wrap = document.createElement("div");
  wrap.className = "grid-wrap";
  wrap.innerHTML = `<div class="view-title">Watchlist (${items.length})</div>`;
  if (!items.length) {
    wrap.innerHTML += `<div class="status">Watchlist gol — adaugă titluri din căutare sau din rânduri.</div>`;
  } else {
    const grid = document.createElement("div");
    grid.className = "grid";
    items.forEach((i) => {
      const c = cardEl(i.title);
      const sel = document.createElement("select");
      sel.className = "wl-status";
      Object.entries(WL_LABELS).forEach(([v, label]) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = label;
        o.selected = i.status === v;
        sel.appendChild(o);
      });
      sel.addEventListener("change", async () => {
        try {
          await api("/api/watchlist", {
            method: "POST",
            body: JSON.stringify({ title_id: i.title.id, status: sel.value }),
          });
          state.wlStatus[i.title.id] = sel.value;
          toast(`${WL_LABELS[sel.value]}: ${i.title.name}`);
        } catch (err) {
          toast(err.message, false);
        }
      });
      c.appendChild(sel);
      grid.appendChild(c);
    });
    wrap.appendChild(grid);
  }
  content.innerHTML = "";
  content.appendChild(wrap);
}

/* ================= CONTINUĂ ================= */
async function loadContinue() {
  const seq = viewSeq;
  content.innerHTML = `<div class="grid-wrap"><div class="view-title">Continuă vizionarea</div>${skelGrid(6)}</div>`;
  try {
    state.history = await api("/api/history");
  } catch (err) {
    if (seq === viewSeq) content.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
    return;
  }
  if (seq !== viewSeq) return;
  const wrap = document.createElement("div");
  wrap.className = "grid-wrap";
  const live = state.history.filter(isContinuable);
  wrap.innerHTML = `<div class="view-title">Continuă vizionarea (${live.length})</div>`;
  if (!live.length) {
    wrap.innerHTML += `<div class="status">Niciun titlu în curs de vizionare.</div>`;
  } else {
    const grid = document.createElement("div");
    grid.className = "grid";
    live.forEach((h) => {
      grid.appendChild(
        cardEl(h.title, { progress: h.position_seconds, duration: h.duration_seconds, sub: historyLabel(h) })
      );
    });
    wrap.appendChild(grid);
  }
  content.innerHTML = "";
  content.appendChild(wrap);
}

/* ================= LIVE (Ace Stream) ================= */
async function loadLive() {
  const seq = viewSeq;
  content.innerHTML = `
    <div class="grid-wrap live-page">
      <div class="view-title">Live</div>
      <div class="cal-hint">Transmisii în direct prin rețeaua Ace Stream (P2P: cu cât mai mulți spectatori, cu atât mai stabil). Lipește un ID sau un link <code>acestream://…</code> și apasă Pornește; îl poți salva ca să-l ai mereu aici.</div>
      <form class="ts-form" id="live-form">
        ${svg("M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm-7.07-2.93 1.41 1.41a8 8 0 0 0 0 11.04l-1.41 1.41a10 10 0 0 1 0-13.86zm14.14 0a10 10 0 0 1 0 13.86l-1.41-1.41a8 8 0 0 0 0-11.04z", 20)}
        <input id="live-ref" placeholder="acestream://… sau ID de 40 de caractere" autocomplete="off">
        <input id="live-name" class="live-name" placeholder="Nume (opțional)" autocomplete="off">
        <button class="btn" type="submit">Pornește</button>
        <button class="btn ghost" type="button" id="live-save">Salvează</button>
      </form>
      <div class="sub-title live-sub">Canalele mele</div>
      <div id="live-list" class="sp-list"><div class="status">Se încarcă…</div></div>
    </div>`;
  const refEl = $("#live-ref"), nameEl = $("#live-name");
  const drawList = (items) => {
    const box = $("#live-list");
    if (!box) return;
    if (!items.length) {
      box.innerHTML = `<div class="status">Niciun canal salvat. Lipește un ID mai sus și apasă „Salvează”.</div>`;
      return;
    }
    box.innerHTML = "";
    items.forEach((c) => {
      const row = document.createElement("div");
      row.className = "sp-row live-row";
      row.innerHTML = `
        <div class="live-dot"></div>
        <div class="sp-main"><div class="sp-match">${esc(c.name)}</div><div class="sp-meta">${esc(c.kind === "infohash" ? "infohash" : "acestream")} · ${esc(c.hash.slice(0, 12))}…</div></div>
        <div class="sp-vars">
          <button class="sp-var" data-a="play">${svg(I.play, 13)} <b>Pornește</b></button>
          <button class="sp-var" data-a="del" title="Șterge canalul">${svg(I.trash, 13)}</button>
        </div>`;
      row.querySelector('[data-a="play"]').addEventListener("click", () =>
        playLive({ name: c.name, ref: c.kind === "infohash" ? `ih:${c.hash}` : c.hash })
      );
      row.querySelector('[data-a="del"]').addEventListener("click", async () => {
        if (!confirm(`Ștergi canalul „${c.name}”?`)) return;
        try {
          drawList(await api(`/api/live/channels/${c.hash}`, { method: "DELETE" }));
        } catch (err) {
          toast(err.message, false);
        }
      });
      box.appendChild(row);
    });
  };
  $("#live-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (refEl.value.trim().length < 10) return refEl.focus();
    playLive({ name: nameEl.value.trim() || "Live", ref: refEl.value.trim() });
  });
  $("#live-save").addEventListener("click", async () => {
    if (refEl.value.trim().length < 10) return refEl.focus();
    try {
      drawList(await api("/api/live/channels", { method: "POST", body: JSON.stringify({ name: nameEl.value, ref: refEl.value }) }));
      toast("Canal salvat");
      refEl.value = nameEl.value = "";
    } catch (err) {
      toast(err.message, false);
    }
  });
  try {
    const items = await api("/api/live/channels");
    if (seq === viewSeq) drawList(items);
  } catch (err) {
    if (seq === viewSeq) $("#live-list").innerHTML = `<div class="status error">${esc(err.message)}</div>`;
  }
}

/* hls.js se încarcă doar la prima transmisie live (Chrome/Firefox nu redau HLS nativ) */
let hlsLoading = null;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  hlsLoading =
    hlsLoading ||
    new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
      s.onload = () => resolve(window.Hls);
      s.onerror = () => {
        hlsLoading = null;
        reject(new Error("Nu am putut încărca player-ul HLS"));
      };
      document.head.appendChild(s);
    });
  return hlsLoading;
}

async function playLive({ name, ref }) {
  enterCinema({ id: null, name, type: "movie" });
  cinema.classList.add("cin-live"); // fără versiuni/stare torrent: doar player-ul
  $("#cin-sub").textContent = "Live · Ace Stream";
  const ps = beginPlay();
  const playerBox = $("#player");
  if (!playerBox) return;
  playerBox.innerHTML = `<div class="cin-status">Conectare la rețeaua Ace Stream…<small>prima pornire poate dura 10–30 s</small></div>`;
  let sess;
  try {
    sess = await api("/api/live/start", { method: "POST", body: JSON.stringify({ ref }) });
  } catch (err) {
    if (ps === playSeq) playerBox.innerHTML = `<div class="cin-status error">${esc(err.message)}</div>`;
    return;
  }
  const stopSession = () =>
    api(`/api/live/stop/${sess.infohash}/${sess.session}`, { method: "POST", keepalive: true }).catch(() => {});
  if (ps !== playSeq) return stopSession();

  let Hls = null;
  const video0 = document.createElement("video");
  if (!video0.canPlayType("application/vnd.apple.mpegurl")) {
    try {
      Hls = await loadHls();
    } catch (err) {
      stopSession();
      if (ps === playSeq) playerBox.innerHTML = `<div class="cin-status error">${esc(err.message)}</div>`;
      return;
    }
    if (ps !== playSeq) return stopSession();
  }

  const ctx = { alive: true, onStop: [] };
  playerBox.innerHTML = playerHtml();
  playerBox.querySelector(".cin-video").classList.add("is-live");
  const video = playerBox.querySelector("#video");
  $("#buffer").classList.remove("hidden");

  // statistici: peers, viteză, prebuffering
  const refreshLive = async () => {
    if (!ctx.alive) return;
    try {
      const s = await api(`/api/live/stat/${sess.infohash}/${sess.session}`);
      if (!ctx.alive) return;
      const pre = s.status === "prebuf" ? ` · prebuffering ${s.progress || 0}%` : "";
      $("#cin-mini").innerHTML = `<span class="dot-${s.peers > 2 ? "ok" : s.peers ? "mid" : "bad"}"></span>${sess.is_live ? "LIVE · " : ""}${s.peers} peers · ↓ ${fmtMbit(s.down_bps)} Mbit/s${pre}`;
    } catch (_) {}
  };
  refreshLive();
  const statTimer = setInterval(refreshLive, 3000);

  // playlist-ul apare după prebuffering: hls.js reîncearcă până e gata
  let hls = null;
  if (Hls) {
    hls = new Hls({
      liveSyncDurationCount: 3,
      manifestLoadingMaxRetry: 30,
      manifestLoadingRetryDelay: 2000,
      levelLoadingMaxRetry: 10,
      fragLoadingMaxRetry: 10,
    });
    hls.loadSource(sess.playlist);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (!d.fatal || !ctx.alive) return;
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR) return hls.recoverMediaError();
      const box = playerBox.querySelector("#video-error");
      if (box) {
        box.textContent = "Transmisia nu răspunde (prea puțini peers sau ID expirat). Încearcă din nou sau alt canal.";
        box.classList.remove("hidden");
      }
    });
  } else {
    video.src = sess.playlist; // Safari: HLS nativ
  }

  enhanceVideo(video, { ctx });
  playerCleanup = () => {
    ctx.alive = false;
    clearInterval(statTimer);
    ctx.onStop.forEach((fn) => fn());
    try {
      if (hls) hls.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch (_) {}
    stopSession();
  };
}

/* ================= SPORT (ultimele apariții RGFootball) ================= */
let sportComp = "all";

async function loadSport() {
  const seq = viewSeq;
  content.innerHTML = `
    <div class="grid-wrap sp-page">
      <div class="view-title">Sport</div>
      <div class="cal-hint">Ultimele meciuri și evenimente apărute pe RGFootball. Clic pe o calitate pornește înregistrarea în player.</div>
      <div class="status">Se încarcă meciurile…</div>
    </div>`;
  let data;
  try {
    data = await api("/api/sport");
  } catch (err) {
    if (seq === viewSeq) content.querySelector(".status").outerHTML = `<div class="status error">${esc(err.message)}</div>`;
    return;
  }
  if (seq !== viewSeq) return;
  const matches = data.matches || [];
  const wrap = content.querySelector(".sp-page");
  if (!matches.length) {
    wrap.querySelector(".status").textContent = "Nicio apariție recentă.";
    return;
  }

  const counts = {};
  matches.forEach((m) => (counts[m.competition] = (counts[m.competition] || 0) + 1));
  const comps = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  if (sportComp !== "all" && !counts[sportComp]) sportComp = "all";
  wrap.querySelector(".status").remove();
  const chips = document.createElement("div");
  chips.className = "q-filter sp-comps";
  chips.innerHTML = [["all", `Toate ${matches.length}`], ...comps.map((c) => [c, `${c} ${counts[c]}`])]
    .map(([v, l]) => `<button data-c="${esc(v)}" class="${v === sportComp ? "on" : ""}">${esc(l)}</button>`)
    .join("");
  wrap.appendChild(chips);
  const list = document.createElement("div");
  wrap.appendChild(list);

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const dayLabel = (d) => {
    if (!d) return "Fără dată";
    const long = new Date(d + "T12:00:00").toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long" });
    return d === today ? `Azi · ${long}` : d === yesterday ? `Ieri · ${long}` : long[0].toUpperCase() + long.slice(1);
  };

  const draw = () => {
    list.innerHTML = "";
    const byDay = new Map();
    matches
      .filter((m) => sportComp === "all" || m.competition === sportComp)
      .forEach((m) => (byDay.has(m.date) ? byDay.get(m.date) : byDay.set(m.date, []).get(m.date)).push(m));
    for (const [d, ms] of byDay) {
      const sec = document.createElement("section");
      sec.className = "cal-day" + (d === today ? " today" : "");
      sec.innerHTML = `<div class="cal-day-head">${esc(dayLabel(d))}<span>${ms.length}</span></div><div class="sp-list"></div>`;
      const box = sec.querySelector(".sp-list");
      ms.forEach((m) => {
        const row = document.createElement("div");
        row.className = "sp-row";
        row.innerHTML = `
          <div class="sp-comp">${esc(m.competition)}</div>
          <div class="sp-main">
            <div class="sp-match">${esc(m.match)}</div>
            <div class="sp-meta">${[m.country, m.round].filter(Boolean).map(esc).join(" · ")}</div>
          </div>
          <div class="sp-vars"></div>`;
        const vars = row.querySelector(".sp-vars");
        m.variants.forEach((v) => {
          const b = document.createElement("button");
          b.className = "sp-var";
          b.title = v.name;
          b.innerHTML = `${svg(I.play, 13)} <b>${esc(v.quality || "Redă")}</b><small>${esc(v.size || "")}${v.seeds != null ? ` · ▲ ${Number(v.seeds)}` : ""}</small>`;
          b.addEventListener("click", () =>
            playTorrent({ id: null, name: `${m.match} · ${m.competition}`, type: "movie" }, v, {})
          );
          vars.appendChild(b);
        });
        box.appendChild(row);
      });
      list.appendChild(sec);
    }
  };
  chips.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      sportComp = b.dataset.c;
      chips.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      draw();
    })
  );
  draw();
}

/* ================= CĂUTARE TORRENTE (direct în trackere, fără catalog) ================= */
let tsSource = "all";

async function loadTorrentSearch(q) {
  const seq = viewSeq;
  q = (q || "").trim();
  content.innerHTML = `
    <div class="grid-wrap ts-page">
      <div class="view-title">Căutare torrente</div>
      <div class="cal-hint">Caută direct în toate trackerele — orice, nu doar filme din catalog (concerte, documentare, emisiuni…). Clic pe un rezultat îl pornește în player.</div>
      <form class="ts-form" id="ts-form">
        ${svg("M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z", 20)}
        <input id="ts-q" type="search" placeholder="Ce cauți? (ex. Queen Live Aid, BBC Planet Earth…)" autocomplete="off" value="${esc(q)}">
        <button class="btn" type="submit">Caută</button>
      </form>
      <div id="ts-sources" class="q-filter ts-sources"></div>
      <div id="ts-note" class="ts-note"></div>
      <div id="torrents"></div>
    </div>`;
  const input = $("#ts-q");
  $("#ts-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (v.length < 2) return input.focus();
    go(`#/torrents/${encodeURIComponent(v)}`);
  });
  if (!q) {
    input.focus();
    return;
  }

  const box = $("#torrents");
  box.innerHTML = `<div class="status">Caut în toate trackerele… (cel mult ~15 s)</div>`;
  let data;
  try {
    data = await api(`/api/torrents/search?q=${encodeURIComponent(q)}`);
  } catch (err) {
    if (seq === viewSeq) box.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
    return;
  }
  if (seq !== viewSeq) return;
  document.title = `${q} — Torrente — Cinema`;

  const notes = [];
  if (data.slow.length) notes.push(`Nu au răspuns la timp: ${data.slow.join(", ")}`);
  if (data.failed.length) notes.push(`Indisponibile acum: ${data.failed.join(", ")}`);
  $("#ts-note").textContent = notes.join(" · ");

  if (!data.results.length) {
    box.innerHTML = `<div class="status">Niciun rezultat pentru „${esc(q)}”.</div>`;
    return;
  }
  // fiecare rând se redă cu propriul nume ca titlu (nu există pagină de film în catalog)
  const pseudo = { id: null, name: q, type: "movie" };
  buildTorrentsList(pseudo, data.results, {
    label: "Rezultate",
    titleFor: (r) => ({ id: null, name: r.name, type: "movie" }),
  });

  // filtru pe sursă (se combină cu filtrul pe calitate din listă)
  const counts = {};
  data.results.forEach((r) => {
    const s = r.indexer || r.source || "?";
    counts[s] = (counts[s] || 0) + 1;
  });
  const sources = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  if (tsSource !== "all" && !counts[tsSource]) tsSource = "all";
  const srcBox = $("#ts-sources");
  if (sources.length > 1) {
    srcBox.innerHTML = [["all", `Toate sursele ${data.results.length}`], ...sources.map((s) => [s, `${s} ${counts[s]}`])]
      .map(([v, l]) => `<button data-src="${esc(v)}" class="${v === tsSource ? "on" : ""}">${esc(l)}</button>`)
      .join("");
    const applySrc = () =>
      document.querySelectorAll("#torrent-list .torrent-row").forEach((row) =>
        row.classList.toggle("hide-src", tsSource !== "all" && row.dataset.src !== tsSource)
      );
    srcBox.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        tsSource = b.dataset.src;
        srcBox.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
        applySrc();
      })
    );
    applySrc();
  }
}

/* ================= CALENDAR APARIȚII ================= */
const CAL_KINDS = {
  cinema: { label: "Cinema", cls: "k-cinema" },
  digital: { label: "Digital", cls: "k-digital" }, // de obicei apare atunci și pe torrente
  episode: { label: "Episod nou", cls: "k-episode" },
};
const CAL_FILTERS = [
  ["all", "Toate"],
  ["cinema", "Premiere în cinema"],
  ["digital", "Lansări digitale"],
  ["episode", "Episoade noi"],
  ["mine", "Serialele mele"],
];
let calFilter = "all";

async function loadCalendar() {
  const seq = viewSeq;
  content.innerHTML = `
    <div class="grid-wrap">
      <div class="view-title">Calendar apariții</div>
      <div class="status">Se adună aparițiile… (prima dată după o repornire poate dura ~15 s)</div>
    </div>`;
  let data;
  try {
    data = await api("/api/calendar?back=7&ahead=60");
  } catch (err) {
    if (seq === viewSeq) content.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
    return;
  }
  if (seq !== viewSeq) return;

  const today = data.today;
  const tomorrow = new Date(new Date(today + "T12:00:00").getTime() + 864e5).toISOString().slice(0, 10);
  const dayLabel = (d) => {
    const long = new Date(d + "T12:00:00").toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long" });
    return d === today ? `Azi · ${long}` : d === tomorrow ? `Mâine · ${long}` : long[0].toUpperCase() + long.slice(1);
  };
  const counts = { all: data.events.length, mine: data.events.filter((e) => e.followed).length };
  data.events.forEach((e) => (counts[e.kind] = (counts[e.kind] || 0) + 1));
  if (calFilter !== "all" && !counts[calFilter]) calFilter = "all"; // filtrul ales data trecută nu mai are nimic

  const wrap = document.createElement("div");
  wrap.className = "grid-wrap cal-page";
  wrap.innerHTML = `
    <div class="view-title">Calendar apariții</div>
    <div class="cal-hint">Ultimele 7 zile și următoarele 60. „Digital” = lansarea WEB-DL, momentul în care filmul apare de obicei pe torrente.</div>
    <div class="q-filter cal-filter">${CAL_FILTERS.filter(([k]) => k === "all" || counts[k])
      .map(([k, l]) => `<button data-f="${k}" class="${k === calFilter ? "on" : ""}">${esc(l)} <small>${counts[k] || 0}</small></button>`)
      .join("")}</div>
    <div id="cal-days"></div>`;
  content.innerHTML = "";
  content.appendChild(wrap);

  const daysBox = wrap.querySelector("#cal-days");
  const draw = () => {
    const shown = data.events.filter((e) =>
      calFilter === "all" ? true : calFilter === "mine" ? e.followed : e.kind === calFilter
    );
    daysBox.innerHTML = shown.length ? "" : `<div class="status">Nimic în perioada asta.</div>`;
    const byDay = new Map();
    shown.forEach((e) => (byDay.has(e.date) ? byDay.get(e.date) : byDay.set(e.date, []).get(e.date)).push(e));
    for (const [d, evs] of byDay) {
      const sec = document.createElement("section");
      sec.className = "cal-day" + (d < today ? " past" : d === today ? " today" : "");
      sec.innerHTML = `<div class="cal-day-head">${esc(dayLabel(d))}<span>${evs.length}</span></div><div class="grid"></div>`;
      const grid = sec.querySelector(".grid");
      evs.forEach((e) => {
        const k = CAL_KINDS[e.kind] || CAL_KINDS.cinema;
        const sub = e.kind === "episode"
          ? `S${e.season} · E${e.episode}${e.episode_name && !/^(Episode|Эпизод|Серия)\s*\d+$/i.test(e.episode_name) ? " · " + e.episode_name : ""}`
          : `${e.title.year || ""}${e.title.year ? " · " : ""}${k.label}`;
        const card = cardEl(e.title, { sub, accent: e.kind === "episode" });
        const badge = document.createElement("div");
        badge.className = `cal-badge ${k.cls}`;
        badge.textContent = e.followed ? `★ ${k.label}` : k.label;
        card.querySelector(".card-poster").appendChild(badge);
        grid.appendChild(card);
      });
      daysBox.appendChild(sec);
    }
    // derulăm la ziua de azi (sau prima zi viitoare); zilele trecute rămân deasupra
    const first = daysBox.querySelector(".cal-day.today, .cal-day:not(.past)");
    if (first && daysBox.querySelector(".cal-day.past")) first.scrollIntoView({ block: "start" });
    else window.scrollTo(0, 0);
  };
  wrap.querySelectorAll(".cal-filter button").forEach((b) =>
    b.addEventListener("click", () => {
      calFilter = b.dataset.f;
      wrap.querySelectorAll(".cal-filter button").forEach((x) => x.classList.toggle("on", x === b));
      draw();
    })
  );
  draw();
}

/* ================= DESCĂRCĂRI (cache TorrServer) ================= */
async function loadDownloads() {
  const seq = viewSeq;
  content.innerHTML = `<div class="grid-wrap"><div class="view-title">Descărcări (cache TorrServer)</div><div class="status">Se încarcă...</div></div>`;
  let items;
  try {
    items = await api("/api/downloads");
  } catch (err) {
    if (seq === viewSeq) content.innerHTML = `<div class="status error">${esc(err.message)}</div>`;
    return;
  }
  if (seq !== viewSeq) return;
  const wrap = document.createElement("div");
  wrap.className = "grid-wrap";
  wrap.innerHTML = `<div class="view-title">Descărcări (cache TorrServer) — ${items.length}</div>`;
  if (!items.length) {
    wrap.innerHTML += `<div class="status">Cache-ul TorrServer e gol. Se umple când redai un torrent.</div>`;
    content.innerHTML = "";
    content.appendChild(wrap);
    return;
  }
  const list = document.createElement("div");
  list.className = "torrent-list";
  items.forEach((d) => {
    const row = document.createElement("div");
    row.className = "torrent-row";
    row.innerHTML = `
      <div class="t-name">${esc(d.name)}
        <div class="t-meta">${esc(d.size || "?")}${d.status ? " · " + esc(d.status) : ""}${d.speed ? " · ↓ " + esc(d.speed) : ""}</div>
      </div>
      <button class="btn small danger" title="Șterge din cache">${svg(I.trash, 15)}</button>`;
    row.querySelector("button").addEventListener("click", async () => {
      try {
        await api(`/api/downloads/${encodeURIComponent(d.hash)}`, { method: "DELETE" });
        toast("Șters din cache");
        loadDownloads();
      } catch (err) {
        toast(err.message, false);
      }
    });
    list.appendChild(row);
  });
  wrap.appendChild(list);

  const clear = document.createElement("button");
  clear.className = "btn ghost";
  clear.style.margin = "1rem 0";
  clear.textContent = "Golește tot cache-ul";
  clear.addEventListener("click", async () => {
    if (!confirm(`Ștergi toate cele ${items.length} torrente din cache-ul TorrServer?`)) return;
    clear.disabled = true;
    try {
      for (const d of items) {
        await api(`/api/downloads/${encodeURIComponent(d.hash)}`, { method: "DELETE" });
      }
      toast("Cache golit");
      loadDownloads();
    } catch (err) {
      toast(err.message, false);
      loadDownloads();
    }
  });
  wrap.appendChild(clear);
  content.innerHTML = "";
  content.appendChild(wrap);
}

/* ================= SEARCH ================= */
$("#search-close").addEventListener("click", closeSearch);

function openSearch() {
  searchOverlay.classList.remove("hidden");
  $("#search-results").innerHTML = "";
  $("#search-input").value = "";
  $("#search-input").focus();
}
function closeSearch() {
  searchOverlay.classList.add("hidden");
}

$("#search-input").addEventListener(
  "input",
  debounce(async (e) => {
    const q = e.target.value.trim();
    const box = $("#search-results");
    const current = () => $("#search-input").value.trim() === q; // răspuns pentru textul actual?
    if (q.length < 2) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = `<div class="status">Se caută...</div>`;
    try {
      const { results, errors } = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (!current()) return; // „matri” sosit după „matrix” — ignorat
      box.innerHTML = "";
      if (!results.length) {
        box.innerHTML = `<div class="status">${errors.length ? esc(errors[0]) : "Niciun rezultat."}</div>`;
        return;
      }
      results.forEach((t) => box.appendChild(cardEl(t)));
    } catch (err) {
      if (current()) box.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
    }
  }, 350)
);

$("#search-input").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const q = e.target.value.trim();
  if (q.length < 2) return;
  closeSearch();
  go(`#/search/${encodeURIComponent(q)}`);
});

async function loadSearchPage(q) {
  const seq = viewSeq;
  content.innerHTML = `<div class="grid-wrap"><div class="view-title">Rezultate pentru „${esc(q)}"</div>${skelGrid(8)}</div>`;
  try {
    const { results, errors } = await api(`/api/search?q=${encodeURIComponent(q)}`);
    if (seq !== viewSeq) return;
    content.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "grid-wrap";
    wrap.innerHTML = `<div class="view-title">Rezultate pentru „${esc(q)}" (${results.length})</div>`;
    if (!results.length) {
      wrap.innerHTML += `<div class="status">${errors.length ? esc(errors[0]) : "Niciun rezultat."}</div>`;
    } else {
      const grid = document.createElement("div");
      grid.className = "grid";
      results.forEach((t) => grid.appendChild(cardEl(t)));
      wrap.appendChild(grid);
    }
    content.appendChild(wrap);
  } catch (err) {
    if (seq === viewSeq) content.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
  }
}

/* ================= WATCHLIST API ================= */
async function toggleWatchlist(title) {
  if (state.watchlist.has(title.id)) {
    await api(`/api/watchlist/${title.id}`, { method: "DELETE" });
    state.watchlist.delete(title.id);
    delete state.wlStatus[title.id];
    toast("Scos din watchlist");
  } else {
    await api("/api/watchlist", {
      method: "POST",
      body: JSON.stringify({ title_id: title.id }),
    });
    state.watchlist.add(title.id);
    state.wlStatus[title.id] = "to_watch";
    toast(`Adaugat în watchlist: ${title.name}`);
  }
  return state.watchlist.has(title.id);
}

/* ================= MODAL detaliu ================= */
const modal = $("#modal");
const modalBody = $("#modal-body");

$("#modal-close").addEventListener("click", leaveDetail);
modal.addEventListener("click", (e) => {
  if (e.target === modal) leaveDetail();
});

/* gradient jos cât timp mai există conținut sub marginea vizibilă */
function updateModalFade() {
  const fade = $("#modal-fade");
  if (!fade || modal.classList.contains("hidden")) return;
  const more = modal.scrollHeight - modal.scrollTop - modal.clientHeight > 60;
  fade.classList.toggle("hidden", !more);
}
modal.addEventListener("scroll", updateModalFade, { passive: true });
window.addEventListener("resize", updateModalFade);

/* ---------- ciclul de viață al modalului și al player-ului ----------
   detailSeq: crește la fiecare deschidere/închidere — un /api/title întârziat nu mai
              redeschide nimic după Escape sau după ce ai ales alt titlu.
   playSeq:   crește la fiecare pornire de redare/închidere — clicurile rapide pe
              versiuni/episoade nu se mai suprascriu între ele.
   playerCleanup: oprește player-ul curent (progres final, cronometre, stream). */
let detailSeq = 0;
let playSeq = 0;
let playerCleanup = null;
let lastFocus = null;

/* torrentele care nu se mai redau sunt deconectate în TorrServer după câteva secunde
   (altfel continuă să descarce și iau banda filmului curent). Întârzierea evită
   deconectarea când doar schimbi fișierul în același torrent. */
const pendingDrops = new Map(); // hash -> timeout
function scheduleDrop(hash, delay = 5000) {
  if (!hash) return;
  clearTimeout(pendingDrops.get(hash));
  pendingDrops.set(
    hash,
    setTimeout(() => {
      pendingDrops.delete(hash);
      api("/api/torrents/drop", { method: "POST", keepalive: true, body: JSON.stringify({ hash }) }).catch(() => {});
    }, delay)
  );
}
function keepTorrent(hash) {
  if (pendingDrops.has(hash)) {
    clearTimeout(pendingDrops.get(hash));
    pendingDrops.delete(hash);
  }
}

function stopPlayer() {
  playSeq++;
  if (playerCleanup) {
    const fn = playerCleanup;
    playerCleanup = null;
    fn();
  }
}
/* pornește o redare nouă: oprește ce rula și întoarce tokenul ei */
function beginPlay() {
  stopPlayer();
  return playSeq;
}

/* ================= MODUL CINEMA =================
   La redare, player-ul (#player), lista de versiuni (#torrents) și episoadele (#tab-eps)
   se mută din pagina filmului într-un strat pe toată fereastra; la închidere revin la loc
   (un comentariu-marcaj le ține locul). Mutarea păstrează toți listenerii. */
const cinema = $("#cinema");
const cinemaSlots = {}; // id -> { ph: marcajul din pagină, wasHidden }

function moveIntoCinema(id, target) {
  const el = document.getElementById(id);
  if (!el || cinemaSlots[id]) return;
  const ph = document.createComment(`loc:${id}`);
  el.before(ph);
  cinemaSlots[id] = { ph, wasHidden: el.classList.contains("hidden") };
  el.classList.remove("hidden");
  target.appendChild(el);
}
function restoreFromCinema(id) {
  const slot = cinemaSlots[id];
  if (!slot) return;
  delete cinemaSlots[id];
  const el = document.getElementById(id);
  if (el && slot.ph.isConnected) {
    slot.ph.replaceWith(el);
    el.classList.toggle("hidden", slot.wasHidden);
  } else {
    el?.remove(); // pagina filmului s-a schimbat între timp
    slot.ph.remove();
  }
}
const cinemaOpen = () => !cinema.classList.contains("hidden");

function enterCinema(t) {
  cinema.classList.remove("cin-live");
  $("#cin-title").textContent = t.name;
  $("#cin-sub").textContent = "";
  $("#cin-mini").textContent = "";
  $("#cin-tab-eps").classList.toggle("hidden", t.type !== "series");
  if (cinemaOpen()) return;
  if (!document.getElementById("player")) {
    // pagini fără player propriu (ex. „Torrente”): modul cinema își creează unul temporar
    const p = document.createElement("div");
    p.id = "player";
    p.className = "player-box";
    p.dataset.temp = "1";
    $("#cin-stage").appendChild(p);
  }
  moveIntoCinema("player", $("#cin-stage"));
  moveIntoCinema("torrents", $("#cin-pane-versions"));
  if (t.type === "series") moveIntoCinema("tab-eps", $("#cin-pane-eps"));
  cinema.classList.remove("hidden");
  document.body.classList.add("cinema-open");
  wakeCinemaUi();
}

function exitCinema() {
  if (!cinemaOpen()) return;
  stopPlayer();
  stopStatsPoll();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const p = $("#player");
  if (p && p.dataset.temp) p.remove(); // creat doar pentru modul cinema — nu rămâne dublură
  else if (p) p.innerHTML = "";
  $("#cin-files").innerHTML = "";
  ["player", "torrents", "tab-eps"].forEach(restoreFromCinema);
  setCinemaPanel(null);
  cinema.classList.add("hidden");
  cinema.classList.remove("idle");
  document.body.classList.remove("cinema-open");
}

/* panoul lateral: versiuni / episoade / stare (al doilea clic pe același buton îl închide) */
function setCinemaPanel(name) {
  const panel = $("#cin-panel");
  if (!name || (panel.dataset.pane === name && !panel.classList.contains("hidden"))) {
    panel.classList.add("hidden");
    panel.dataset.pane = "";
    name = null;
  } else {
    panel.classList.remove("hidden");
    panel.dataset.pane = name;
    ["versions", "eps", "stats"].forEach((n) => $(`#cin-pane-${n}`).classList.toggle("hidden", n !== name));
    if (name === "stats") refreshStats();
  }
  document.querySelectorAll(".cin-tab").forEach((b) => b.classList.toggle("on", b.dataset.pane === name));
}
document.querySelectorAll(".cin-tab").forEach((b) => b.addEventListener("click", () => setCinemaPanel(b.dataset.pane)));
$("#cin-close").addEventListener("click", exitCinema);

/* comenzile dispar după 3 s fără mișcare cât timp filmul rulează (ca la cinema) */
let cinemaIdleTimer = null;
function wakeCinemaUi() {
  cinema.classList.remove("idle");
  clearTimeout(cinemaIdleTimer);
  cinemaIdleTimer = setTimeout(() => {
    const v = $("#video");
    const popOpen = cinema.querySelector(".cin-pop:not(.hidden)");
    if (v && !v.paused && !popOpen && cinemaOpen()) cinema.classList.add("idle");
  }, 3000);
}
["mousemove", "pointerdown", "keydown"].forEach((ev) => cinema.addEventListener(ev, wakeCinemaUi, { passive: true }));

/* ---------- starea torrentului (bara de sus + panoul „Stare”) ---------- */
let statsTimer = null;
let currentStream = null; // { hash, size, name, quality }
const fmtMbit = (bps) => (bps / 1e6).toFixed(bps >= 1e7 ? 0 : 1);
const fmtMB = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : Math.round(b / 1e6) + " MB");

function startStatsPoll(info) {
  currentStream = info;
  stopStatsPoll();
  refreshStats();
  statsTimer = setInterval(refreshStats, 3000);
}
function stopStatsPoll() {
  clearInterval(statsTimer);
  statsTimer = null;
}
async function refreshStats() {
  const cur = currentStream;
  if (!cur || !cinemaOpen()) return;
  let s;
  try {
    s = await api(`/api/torrents/stats/${cur.hash}`);
  } catch (_) {
    return;
  }
  if (cur !== currentStream) return;
  const video = $("#video");
  const dur = video && Number.isFinite(video.duration) ? video.duration : 0;
  const bitrate = dur && cur.size ? (cur.size * 8) / dur : 0; // debitul mediu al filmului
  const cacheFull = s.cache_capacity && s.cache_filled >= s.cache_capacity * 0.85; // TorrServer a umplut cache-ul: e înainte
  const ahead = bitrate ? Math.round((s.preloaded * 8) / bitrate) : 0; // secunde încărcate înainte
  let verdict, cls;
  if (cacheFull || (bitrate && s.download_bps >= bitrate * 1.3)) {
    verdict = "Torrentul ține pasul cu filmul.";
    cls = "ok";
  } else if (bitrate && s.download_bps < bitrate && s.preloaded < (s.cache_capacity || 1) * 0.3) {
    verdict = "Torrentul descarcă mai încet decât debitul filmului — poate apărea buffering. Alege o versiune cu mai mulți seederi sau 1080p în loc de 4K.";
    cls = "bad";
  } else {
    verdict = "Se încarcă — viteza ar trebui să ajungă.";
    cls = "mid";
  }
  $("#cin-mini").innerHTML = `<span class="dot-${cls}"></span>↓ ${fmtMbit(s.download_bps)} Mbit/s · ${s.peers_active} peers${ahead ? ` · ${ahead}s în avans` : ""}`;
  if ($("#cin-panel").dataset.pane === "stats") {
    $("#cin-pane-stats").innerHTML = `
      <div class="cin-verdict ${cls}">${esc(verdict)}</div>
      <dl class="facts cin-facts">
        <dt>Viteză descărcare</dt><dd>${fmtMbit(s.download_bps)} Mbit/s</dd>
        <dt>Debitul filmului</dt><dd>${bitrate ? `~${fmtMbit(bitrate)} Mbit/s` : "—"}</dd>
        <dt>Încărcat în avans</dt><dd>${fmtMB(s.preloaded)}${s.cache_capacity ? ` (cache ${fmtMB(s.cache_filled)} din ${fmtMB(s.cache_capacity)})` : ""}${ahead ? ` (~${ahead} s de film)` : ""}</dd>
        <dt>Peers activi</dt><dd>${s.peers_active} din ${s.peers_total} (seederi ${s.seeders})</dd>
        <dt>Upload</dt><dd>${fmtMbit(s.upload_bps)} Mbit/s</dd>
        <dt>Citit până acum</dt><dd>${fmtMB(s.read)}</dd>
        <dt>Mărime fișier</dt><dd>${cur.size ? fmtMB(cur.size) : "—"}</dd>
        <dt>Fișier</dt><dd class="wrap">${esc(cur.name || "")}</dd>
      </dl>
      <div class="cin-hint">Când cache-ul e plin, viteza scade la 0 — e normal: TorrServer așteaptă să consumi din ce a încărcat.</div>`;
  }
}

function closeDetail() {
  exitCinema();
  const wasOpen = !modal.classList.contains("hidden");
  detailSeq++;
  stopPlayer();
  modal.classList.add("hidden");
  modalBody.innerHTML = "";
  document.removeEventListener("keydown", playerKeysHandler);
  if (wasOpen && lastFocus && document.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
  document.title = "Cinema";
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (document.fullscreenElement) return; // Escape iese întâi din fullscreen
    if (cinemaOpen()) return exitCinema();
    if (!searchOverlay.classList.contains("hidden")) return closeSearch();
    if (!modal.classList.contains("hidden")) leaveDetail();
  }
});
// telefon: aplicația trimisă în fundal / tab închis -> salvăm poziția
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && currentProgressSave) currentProgressSave();
});
window.addEventListener("pagehide", () => {
  if (currentProgressSave) currentProgressSave();
  stopPlayer(); // anulează extragerea subtitrărilor
  // tab închis/reîncărcat: torrentul se deconectează imediat, nu peste 5s (pagina nu mai există)
  for (const [hash, timer] of pendingDrops) {
    clearTimeout(timer);
    pendingDrops.delete(hash);
    api("/api/torrents/drop", { method: "POST", keepalive: true, body: JSON.stringify({ hash }) }).catch(() => {});
  }
});

/* afișează pagina filmului (apelată din router pentru #/title/<id>) */
async function showDetail(id, opts = {}) {
  if (modal.classList.contains("hidden")) lastFocus = document.activeElement;
  else stopPlayer(); // titlu similar deschis din pagina filmului: oprim player-ul curent
  const ds = ++detailSeq;
  modal.classList.remove("hidden");
  modal.scrollTop = 0;
  modalBody.innerHTML = `<div class="status">Se încarcă...</div>`;
  $("#modal-close").focus({ preventScroll: true });
  let detail;
  try {
    detail = await api(`/api/title/${id}?_=${Date.now()}`);
  } catch (err) {
    if (ds === detailSeq) modalBody.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
    return;
  }
  if (ds !== detailSeq) return; // închis sau înlocuit între timp
  document.title = `${detail.name} — Cinema`;
  renderModal(detail, opts);
}

/* țări: cod ISO -> nume în rusă (ca restul catalogului), cu prescurtările uzuale */
const COUNTRY_SHORT = { US: "США", GB: "Великобритания", RU: "Россия", KR: "Южная Корея" };
let regionNames = null;
function countryName(code) {
  if (COUNTRY_SHORT[code]) return COUNTRY_SHORT[code];
  try {
    regionNames = regionNames || new Intl.DisplayNames(["ru"], { type: "region" });
    return regionNames.of(code) || code;
  } catch (_) {
    return code;
  }
}
function fmtRuntime(min, isSeries) {
  if (!min) return "";
  const h = Math.floor(min / 60), m = min % 60;
  const s = h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
  return isSeries ? `~${s} / episod` : s;
}

/* antetul paginii de film, ca în Lampa: an + țară, titlu mare, slogan, etichete, durată + genuri */
function detailHeadHtml(t, isSeries) {
  const pre = [t.year, ...(t.countries || []).map(countryName)].filter(Boolean).join(", ");
  // ratingurile: TMDB · Kinopoisk · IMDb (ultimele două vin din Kinopoisk, dacă e configurat)
  const kp = t.kp || {};
  const rate = (v, label, cls = "") => (v ? `<span class="d-rate ${cls}">${Number(v).toFixed(1)} <small>${label}</small></span>` : "");
  const badges = [
    rate(t.rating, "TMDB"),
    kp.rating_kp
      ? `<a class="d-rate kp" href="${escUrl(kp.url)}" target="_blank" rel="noopener" title="Kinopoisk${kp.votes_kp ? ` · ${Number(kp.votes_kp).toLocaleString("ru-RU")} voturi` : ""}">${Number(kp.rating_kp).toFixed(1)} <small>КП</small></a>`
      : "",
    rate(kp.rating_imdb, "IMDb", "imdb"),
    t.certification ? `<span class="d-box">${esc(t.certification)}</span>` : "",
    t.status ? `<span class="d-box">${esc(t.status)}</span>` : "",
    `<span class="d-box soft">${isSeries ? "serial" : "film"}</span>`,
  ].join("");
  const meta = [fmtRuntime(t.runtime, isSeries), (t.genres || []).join(" | ")].filter(Boolean);
  const showOriginal = t.name_original && t.name_original !== t.name;
  return `
    ${pre ? `<div class="d-pre">${esc(pre)}</div>` : ""}
    <h2>${esc(t.name)}</h2>
    ${showOriginal ? `<div class="modal-original">${esc(t.name_original)}</div>` : ""}
    ${t.tagline ? `<div class="d-tagline">${esc(t.tagline)}</div>` : ""}
    <div class="d-badges">${badges}</div>
    ${meta.length ? `<div class="d-meta">${meta.map(esc).join(' <span class="dot">•</span> ')}</div>` : ""}`;
}

function renderModal(t, opts = {}) {
  exitCinema(); // nodurile mutate în modul cinema trebuie readuse înainte de re-randare
  stopPlayer();
  epsBySeason = {}; // cache episoade per titlu deschis
  const ds = detailSeq;
  const isSeries = t.type === "series";
  const inWl = state.watchlist.has(t.id);

  modalBody.innerHTML = `
    <div class="modal-head${t.backdrop ? " has-backdrop" : ""}">
      <div class="modal-backdrop${t.backdrop ? " sharp" : ""}" style="background-image:${cssUrl(t.backdrop || t.poster)}"></div>
      <div class="modal-head-inner">
        <div class="modal-poster">${t.poster ? `<img alt="" src="${escUrl(t.poster)}">` : ""}</div>
        <div class="modal-info">
          ${detailHeadHtml(t, isSeries)}
          ${t.description ? `<div class="modal-desc" id="desc">${esc(t.description)}</div>` : ""}
          <div class="modal-actions">
            ${isSeries ? "" : `<button class="btn big" id="m-play">${svg(I.play)} Vizionează</button>`}
            ${isSeries ? `<button class="btn big" id="m-eps">${svg(I.play)} Episoade</button>` : ""}
            <button class="btn ghost" id="m-wl">${svg(I.star, 16)} ${inWl ? "În watchlist" : "Watchlist"}</button>
            ${t.trailer ? `<button class="btn ghost" id="m-trailer">${svg(I.yt, 16)} Trailer</button>` : ""}
            <span id="m-seg-wrap"></span>
          </div>
        </div>
      </div>
    </div>

    <div class="tabs" id="m-tabs">
      <button data-tab="play" class="on">Redare</button>
      ${isSeries ? `<button data-tab="eps">Episoade</button>` : ""}
      <button data-tab="info">Detalii</button>
    </div>

    <div id="tab-play" class="tab-panel">
      <div class="resume-chip" id="resume-chip"></div>
      <div id="player" class="player-box"></div>
      <div id="pill" class="auto-pill hidden"></div>
      <div id="torrents"></div>
    </div>
    ${isSeries ? `<div id="tab-eps" class="tab-panel hidden"></div>` : ""}
    <div id="tab-info" class="tab-panel hidden"></div>
    <div class="rows d-rows" id="d-rows"></div>
  `;

  const descEl = modalBody.querySelector("#desc");
  if (descEl) descEl.addEventListener("click", () => descEl.classList.toggle("expanded"));

  // watchlist: actualizăm doar butonul și segmentul — player-ul rămâne neatins
  const renderSeg = () => {
    const wrap = modalBody.querySelector("#m-seg-wrap");
    if (!wrap) return;
    if (!state.watchlist.has(t.id)) {
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML = `<span class="seg" id="m-seg">${Object.entries(WL_LABELS)
      .map(([v, l]) => `<button data-v="${v}" class="${state.wlStatus[t.id] === v ? "on" : ""}">${l}</button>`)
      .join("")}</span>`;
    const seg = wrap.querySelector("#m-seg");
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await api("/api/watchlist", {
            method: "POST",
            body: JSON.stringify({ title_id: t.id, status: b.dataset.v }),
          });
          state.wlStatus[t.id] = b.dataset.v;
          seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
          toast(`${WL_LABELS[b.dataset.v]}: ${t.name}`);
        } catch (err) {
          toast(err.message, false);
        }
      })
    );
  };
  renderSeg();
  modalBody.querySelector("#m-wl").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const on = await toggleWatchlist(t);
      btn.innerHTML = `${svg(I.star, 16)} ${on ? "În watchlist" : "Watchlist"}`;
      renderSeg();
    } catch (err) {
      toast(err.message, false);
    } finally {
      btn.disabled = false;
    }
  });
  const trailerBtn = modalBody.querySelector("#m-trailer");
  if (trailerBtn) {
    trailerBtn.addEventListener("click", () => playTrailer(t));
  }

  // taburi
  modalBody.querySelectorAll("#m-tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      switchTab(b.dataset.tab);
      setTimeout(updateModalFade, 250);
    })
  );
  function switchTab(name) {
    modalBody.querySelectorAll("#m-tabs button").forEach((x) => x.classList.toggle("on", x.dataset.tab === name));
    ["play", "eps", "info"].forEach((n) => {
      const p = modalBody.querySelector(`#tab-${n}`);
      if (p) p.classList.toggle("hidden", n !== name);
    });
  }
  if (opts.keepTab) switchTab(opts.keepTab);
  setTimeout(updateModalFade, 250);

  if (isSeries) {
    modalBody.querySelector("#m-eps").addEventListener("click", () => switchTab("eps"));
    renderEpisodesTab(t);
  } else {
    modalBody.querySelector("#m-play").addEventListener("click", () => autoPlayBest(t));
  }
  renderInfoTab(t);
  renderRelatedRows(t);

  // resume
  (async () => {
    try {
      const hist = await api(`/api/title/${t.id}/history`);
      if (ds !== detailSeq) return;
      // ultima poziție neterminată (un film/episod văzut până la capăt nu mai e „de continuat”)
      const last = hist.find(isUnfinished);
      if (!last) return;
      const chip = modalBody.querySelector("#resume-chip");
      if (!chip) return;
      const label = last.season ? `S${last.season}E${last.episode} · ` : "";
      chip.innerHTML = `⏱ Ultima redare: ${label}${fmtTime(last.position_seconds)}
        <button class="btn small">Continuă</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        if (isSeries && last.season) {
          switchTab("eps");
          playEpisode(t, last.season, last.episode, last.position_seconds);
        } else {
          autoPlayBest(t, last.position_seconds);
        }
      });
    } catch (_) {}
  })();

  // fără redare automată la deschidere (pornea torrentul pentru orice film răsfoit):
  // doar lista de versiuni; filmul pornește în modul cinema la „Vizionează” / clic pe versiune
  if (!isSeries) {
    if (opts.seekTo) autoPlayBest(t, opts.seekTo);
    else loadVersions(t);
  }
}

/* ---------- trailer în modal (embed, nu fereastră nouă) ---------- */
function playTrailer(t) {
  const playerBox = $("#player");
  if (!playerBox || !t.trailer) return;
  let key = null;
  try {
    key = new URL(t.trailer).searchParams.get("v");
  } catch (_) {}
  if (!key) {
    window.open(t.trailer, "_blank", "noopener");
    return;
  }
  // salvăm poziția filmului ca să reluăm de unde a rămas
  const video = $("#video");
  const resumeAt = video && video.currentTime > 15 ? video.currentTime : null;
  stopPlayer(); // salvează progresul, oprește stream-ul și orice redare încă în pornire

  const tabPlay = modalBody.querySelector("#m-tabs button[data-tab='play']");
  if (tabPlay) tabPlay.click();

  playerBox.innerHTML = `
    <div class="trailer-wrap">
      <iframe src="https://www.youtube-nocookie.com/embed/${escUrl(key)}?autoplay=1&rel=0"
        allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
    </div>
    <div class="video-extra">
      <span class="cc-state on">Trailer</span>
      <button class="btn small ghost" id="trailer-back">${svg(I.play, 14)} Înapoi la film</button>
    </div>`;
  $("#torrents").classList.add("hidden");
  const pill = $("#pill");
  if (pill) pill.classList.add("hidden");

  playerBox.querySelector("#trailer-back").addEventListener("click", () => {
    $("#torrents").classList.remove("hidden");
    if (pill) pill.classList.remove("hidden");
    playerBox.innerHTML = "";
    if (t.type === "series") {
      const epsTab = modalBody.querySelector("#m-tabs button[data-tab='eps']");
      if (epsTab) epsTab.click();
    } else if (resumeAt) {
      autoPlayBest(t, resumeAt); // filmul rula înainte de trailer: îl reluăm
    } // altfel rămâi pe pagină; filmul pornește la „Vizionează”
  });
  setTimeout(updateModalFade, 250);
}

/* ---------- tab Detalii: descriere completă + fișa titlului ---------- */
function renderInfoTab(t) {
  const panel = modalBody.querySelector("#tab-info");
  if (!panel) return;
  const isSeries = t.type === "series";
  const facts = [
    ["Titlu original", t.name_original && t.name_original !== t.name ? t.name_original : ""],
    ["An", t.year],
    ["Țări", (t.countries || []).map(countryName).join(", ")],
    ["Genuri", (t.genres || []).join(", ")],
    [isSeries ? "Durata episodului" : "Durată", fmtRuntime(t.runtime, false)],
    ["Status", t.status],
    ["Limită de vârstă", t.certification],
    ["Sezoane", isSeries && t.seasons && t.seasons.length ? t.seasons.filter((s) => s.season > 0).length : ""],
  ].filter(([, v]) => v);
  panel.innerHTML = `
    ${t.description ? `<div class="info-desc">${esc(t.description)}</div>` : ""}
    ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
  `;
}

/* ---------- sub pagina filmului: Actori, Recomandări, Similare (rânduri ca pe Acasă) ---------- */
function renderRelatedRows(t) {
  const box = modalBody.querySelector("#d-rows");
  if (!box) return;
  const cast = (t.cast || []).filter((c) => c.name);
  if (cast.length) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<div class="row-title"><div>Actori</div></div><div class="cast-scroll"></div>`;
    const scroll = row.querySelector(".cast-scroll");
    cast.forEach((c) => {
      const chip = document.createElement("div");
      chip.className = "cast-chip" + (c.id ? " link" : "");
      chip.innerHTML = `
        ${c.profile ? `<img src="${escUrl(c.profile)}" loading="lazy" alt="">` : `<div class="cast-noimg">${svg(I.info, 20)}</div>`}
        <div class="cast-name">${esc(c.name)}</div><div class="cast-char">${esc(c.character || "")}</div>`;
      if (c.id) makeActivatable(chip, () => go(`#/person/${c.id}`), c.name);
      scroll.appendChild(chip);
    });
    box.appendChild(row);
  }
  if ((t.recommendations || []).length) box.appendChild(rowEl("Recomandări", t.recommendations));
  if ((t.similar || []).length) box.appendChild(rowEl("Similare", t.similar));
}

/* ================= PAGINA ACTORULUI ================= */
async function loadPerson(id) {
  const seq = viewSeq;
  content.innerHTML = `<div class="grid-wrap"><div class="status">Se încarcă...</div></div>`;
  let p;
  try {
    p = await api(`/api/person/${id}`);
  } catch (err) {
    if (seq === viewSeq) content.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
    return;
  }
  if (seq !== viewSeq) return;
  document.title = `${p.name} — Cinema`;
  const fmtDate = (d) => {
    try {
      return new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
    } catch (_) {
      return d;
    }
  };
  const age = p.birthday && !p.deathday
    ? Math.floor((Date.now() - new Date(p.birthday)) / (365.25 * 24 * 3600 * 1000))
    : null;
  const facts = [
    p.birthday ? `Născut: ${fmtDate(p.birthday)}${age ? ` (${age} ani)` : ""}` : "",
    p.deathday ? `Decedat: ${fmtDate(p.deathday)}` : "",
    p.place_of_birth || "",
  ].filter(Boolean);
  const wrap = document.createElement("div");
  wrap.className = "grid-wrap person-page";
  wrap.innerHTML = `
    <div class="person-head">
      <div class="person-photo">${p.photo ? `<img src="${escUrl(p.photo)}" alt="">` : svg(I.info, 48)}</div>
      <div class="person-info">
        <div class="d-pre">${esc(p.department === "Directing" ? "Regizor" : "Actor")}</div>
        <h1>${esc(p.name)}</h1>
        ${facts.length ? `<div class="d-meta">${facts.map(esc).join(' <span class="dot">•</span> ')}</div>` : ""}
        ${p.biography ? `<div class="person-bio" id="person-bio">${esc(p.biography)}</div>` : ""}
      </div>
    </div>
    <div class="view-title">Filmografie (${p.works.length})</div>`;
  const grid = document.createElement("div");
  grid.className = "grid";
  p.works.forEach((w) => grid.appendChild(cardEl(w, w.role ? { sub: `${w.year || ""}${w.year ? " · " : ""}${w.role}`, accent: false } : {})));
  wrap.appendChild(grid);
  content.innerHTML = "";
  content.appendChild(wrap);
  const bio = wrap.querySelector("#person-bio");
  if (bio) bio.addEventListener("click", () => bio.classList.toggle("expanded"));
}

/* ---------- tab Episoade: sezoane din TMDB, episoade încărcate leneș per sezon ---------- */
let epsBySeason = {}; // season -> [episoade] (pentru „Urmează")

async function renderEpisodesTab(t) {
  const ds = detailSeq;
  const panel = modalBody.querySelector("#tab-eps");
  if (!panel) return;
  panel.innerHTML = `<div class="status">Se încarcă sezoanele...</div>`;
  let hist = [];
  try {
    hist = await api(`/api/title/${t.id}/history`);
  } catch (_) {}
  if (ds !== detailSeq) return;
  const byEp = new Map(hist.map((h) => [`${h.season}x${h.episode}`, h]));

  // sezoanele: din TMDB (t.seasons) sau din episoadele deja în DB (fallback)
  let seasons = (t.seasons || []).map((s) => s.season).filter((s) => s != null);
  if (!seasons.length) seasons = [...new Set((t.episodes || []).map((e) => e.season))].sort((a, b) => a - b);
  if (!seasons.length) {
    panel.innerHTML = `<div class="status">Niciun sezon găsit.</div>`;
    return;
  }
  // se deschide sezonul ultimului episod văzut (istoricul vine sortat descrescător după dată)
  const lastSeen = hist.find((h) => h.season != null && seasons.includes(h.season));
  const initialSeason = lastSeen ? lastSeen.season : seasons.includes(1) ? 1 : seasons[seasons.length - 1];
  panel.innerHTML = `
    <div class="season-chips" id="season-chips">
      ${seasons.map((s) => `<button data-s="${s}" class="${s === initialSeason ? "on" : ""}">Sezonul ${s}</button>`).join("")}
    </div>
    <div class="eps-grid" id="eps-grid"></div>`;

  const grid = panel.querySelector("#eps-grid");
  const CHUNK = 24;

  let wantedSeason = initialSeason;
  async function loadSeason(s) {
    wantedSeason = s;
    if (!epsBySeason[s]) {
      grid.innerHTML = `<div class="status">Se încarcă sezonul ${s}...</div>`;
      let eps;
      try {
        eps = await api(`/api/title/${t.id}/episodes?season=${s}`);
      } catch (_) {
        eps = (t.episodes || []).filter((e) => e.season === s); // fallback din DB
      }
      if (ds !== detailSeq) return; // alt titlu deschis între timp — nu-i stricăm cache-ul
      epsBySeason[s] = eps;
    }
    if (s !== wantedSeason) return; // ai ales între timp alt sezon
    renderSeason(epsBySeason[s] || [], s);
  }

  function renderSeason(eps, s) {
    const shown = { count: CHUNK };
    const draw = () => {
      grid.innerHTML = "";
      eps.slice(0, shown.count).forEach((e) => {
        const h = byEp.get(`${e.season}x${e.episode}`);
        let watched = "";
        if (h && h.duration_seconds) {
          const pct = Math.min(100, Math.round((h.position_seconds / h.duration_seconds) * 100));
          watched = pct >= 92 ? `<div class="ep-done">${svg(I.check, 14)} văzut</div>` : `<div class="ep-progress"><i style="width:${pct}%"></i></div>`;
        }
        const el = document.createElement("div");
        el.className = "ep-card";
        el.innerHTML = `
          <div class="ep-thumb">
            ${e.still ? `<img loading="lazy" decoding="async" alt="" src="${escUrl(e.still)}">` : `<div class="noimg">S${e.season}E${e.episode}</div>`}
            <div class="ep-play">${svg(I.play, 26)}</div>
            ${watched}
          </div>
          <div class="ep-name">${e.episode}. ${esc(e.name || "Episodul " + e.episode)}</div>`;
        makeActivatable(el, () => playEpisode(t, e.season, e.episode), `Redă episodul ${e.episode}`);
        grid.appendChild(el);
      });
      let moreWrap = panel.querySelector("#eps-more-wrap");
      if (moreWrap) moreWrap.remove();
      const remaining = eps.length - shown.count;
      if (remaining > 0) {
        moreWrap = document.createElement("div");
        moreWrap.id = "eps-more-wrap";
        moreWrap.className = "eps-more-wrap";
        moreWrap.innerHTML = `<button class="btn ghost">Arată mai multe (încă ${remaining})</button>`;
        moreWrap.querySelector("button").addEventListener("click", () => {
          shown.count += CHUNK;
          draw();
          setTimeout(updateModalFade, 250);
        });
        grid.after(moreWrap);
      }
      setTimeout(updateModalFade, 250);
    };
    draw();
  }

  panel.querySelectorAll("#season-chips button").forEach((b) =>
    b.addEventListener("click", () => {
      panel.querySelectorAll("#season-chips button").forEach((x) => x.classList.toggle("on", x === b));
      loadSeason(+b.dataset.s);
    })
  );
  loadSeason(initialSeason);
}

/* ================= TORRENȚI + PLAYER ================= */
let lastDetailTitle = null;
let lastTorrentResults = [];

async function fetchTorrents(t, query, altName, opts = {}) {
  const p = new URLSearchParams({ q: query });
  // anul e util la filme; la căutarea de episoade strică (anul debutului ≠ anul sezonului)
  if (t.year && !opts.noYear) p.set("year", t.year);
  if (altName) p.set("alt", altName);
  return api(`/api/torrents?${p}`);
}

function packMentionsSeason(name, season) {
  const n = (name || "").toLowerCase();
  return (
    new RegExp(`s0*${season}(?!\\d)\\s*[\\s._\\-]?e`).test(n) ||
    new RegExp(`(?<!\\d)0*${season}x\\d`).test(n) ||
    new RegExp(`0*${season}\\s*(?:сезон|sezon|season)`).test(n) ||
    new RegExp(`(?:сезон|sezon|season)\\s*0*${season}(?!\\d)`).test(n)
  );
}

async function startStream(source, { fileIndex = 0, season = null, episode = null } = {}) {
  const body = { source, index: fileIndex || 0 };
  if (season != null) body.season = season;
  if (episode != null) body.episode = episode;
  return api("/api/torrents/play", { method: "POST", body: JSON.stringify(body) });
}

/* versiunile filmului (căutare de torrente, fără redare): la deschiderea paginii lista
   apare sub „Vizionează”, dar torrentul nu pornește până nu alegi tu (economie de bandă) */
let versionsFor = null; // { id, promise } — o singură căutare per film deschis
function findVersions(t) {
  if (versionsFor && versionsFor.id === t.id) return versionsFor.promise;
  const q = t.name_original || t.name;
  const alt = t.name_original && t.name_original !== t.name ? t.name : null;
  const promise = fetchTorrents(t, q, alt);
  versionsFor = { id: t.id, promise };
  promise.catch(() => {
    if (versionsFor && versionsFor.promise === promise) versionsFor = null; // reîncercare la următorul clic
  });
  return promise;
}

async function loadVersions(t) {
  const box = $("#torrents");
  if (!box) return;
  const ds = detailSeq;
  box.innerHTML = `<div class="sub-title">Versiuni</div><div class="status" style="padding:1.2rem">Caut versiunile disponibile…</div>`;
  try {
    const results = await findVersions(t);
    if (ds !== detailSeq) return;
    lastTorrentResults = results;
    buildTorrentsList(t, results);
  } catch (err) {
    if (ds === detailSeq) box.innerHTML = `<div class="sub-title">Versiuni</div><div class="status error">${esc(err.message)}</div>`;
  }
}

async function autoPlayBest(t, seekTo = null) {
  enterCinema(t);
  const ps = beginPlay();
  lastDetailTitle = t;
  const playerBox = $("#player");
  if (!playerBox) return;
  playerBox.innerHTML = `<div class="cin-status">Caut release-ul potrivit…</div>`;
  let results;
  try {
    results = await findVersions(t);
  } catch (err) {
    if (ps === playSeq) playerBox.innerHTML = `<div class="cin-status error">${esc(err.message)}</div>`;
    return;
  }
  if (ps !== playSeq) return;
  if (lastTorrentResults !== results) {
    lastTorrentResults = results;
    buildTorrentsList(t, results);
  }
  await playTorrent(t, results[0], { seekTo, ps });
}

/* calitatea ca etichetă scurtă și clasă de culoare */
function qualityOf(r) {
  const q = r.quality || "";
  return { label: q || "—", cls: q === "4K" ? "q-4k" : q === "1080p" ? "q-fhd" : q === "720p" ? "q-hd" : "q-low" };
}

function buildTorrentsList(t, results, opts = {}) {
  const box = $("#torrents");
  if (!box) return;

  // filtre rapide: doar calitățile care chiar există în rezultate + dublaj RU
  const counts = {};
  results.forEach((r) => (counts[r.quality || ""] = (counts[r.quality || ""] || 0) + 1));
  const ruCount = results.filter((r) => r.dub).length;
  const chips = [["all", `Toate ${results.length}`]];
  ["4K", "1080p", "720p"].forEach((q) => counts[q] && chips.push([q, `${q} ${counts[q]}`]));
  if (ruCount && ruCount < results.length) chips.push(["ru", `Dublaj RU ${ruCount}`]);

  box.innerHTML = `<div class="sub-title">${esc(opts.label || "Versiuni")} (${results.length})</div>
    ${chips.length > 2 ? `<div class="q-filter" id="q-filter">${chips
      .map(([v, l], i) => `<button data-f="${v}" class="${i === 0 ? "on" : ""}">${esc(l)}</button>`)
      .join("")}</div>` : ""}
    <div class="torrent-list" id="torrent-list"></div>`;

  const list = box.querySelector("#torrent-list");
  results.forEach((r) => {
    const q = qualityOf(r);
    const row = document.createElement("div");
    row.className = "torrent-row";
    row._src = r;
    row.dataset.q = r.quality || "";
    row.dataset.ru = r.dub ? "1" : "";
    row.dataset.src = r.indexer || r.source || "";
    row.innerHTML = `
      <div class="t-q ${q.cls}">${esc(q.label)}</div>
      <div class="t-name">
        <div class="t-title" title="${esc(r.name)}">${esc(r.name)}</div>
        <div class="t-meta">
          ${r.dub ? `<b class="ru-badge">RU</b>` : ""}
          <span>${esc(r.size || "?")}</span>
          ${r.seeds ? `<span class="t-seeds">▲ ${Number(r.seeds)}</span>` : ""}
          <span class="t-src">${esc(r.indexer || r.source || "?")}</span>
        </div>
      </div>
      <span class="btn-play" aria-hidden="true">${svg(I.play, 14)}</span>`;
    // titleFor: pe pagina „Torrente” fiecare rând e propriul „titlu” (fără catalog)
    makeActivatable(row, () => playTorrent(opts.titleFor ? opts.titleFor(r) : t, r, {}), `Redă: ${r.name}`);
    list.appendChild(row);
  });

  const filter = box.querySelector("#q-filter");
  if (filter) {
    filter.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        filter.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
        const f = b.dataset.f;
        list.querySelectorAll(".torrent-row").forEach((row) => {
          const show = f === "all" || (f === "ru" ? row.dataset.ru === "1" : row.dataset.q === f);
          row.classList.toggle("hide-q", !show); // clasă proprie: se combină cu filtrul pe sursă
        });
        setTimeout(updateModalFade, 50);
      })
    );
  }
}

/* versiunea care rulează: evidențiată în listă + rezumat deasupra listei */
function markPlaying(source) {
  document.querySelectorAll("#torrent-list .torrent-row").forEach((row) =>
    row.classList.toggle("playing", row._src === source)
  );
  pillShow(source);
}

function pillShow(source) {
  const pill = $("#pill");
  if (!pill) return;
  pill.classList.remove("hidden");
  const short = (source.name || "").replace(/\s+/g, " ").slice(0, 70);
  pill.innerHTML = `
    <span class="pill-tag">ACUM</span>
    ${esc(short)}${source.name && source.name.length > 70 ? "…" : ""}
    <span class="dot">·</span> [${esc(source.indexer || source.source || "?")}]
    ${source.dub ? `<span class="dot">·</span> <b class="ru-badge">RU</b>` : ""}
    ${source.quality ? `<span class="dot">·</span> ${esc(source.quality)}` : ""}
    ${source.seeds ? `<span class="dot">·</span> ▲ ${Number(source.seeds)}` : ""}`;
}

/* caută release-uri pentru un episod și rulează pachetul potrivit sezonului */
async function playEpisode(t, season, episode, seekTo = null) {
  enterCinema(t);
  $("#cin-sub").textContent = `S${season} · E${episode}`;
  const ps = beginPlay();
  const playerBox = $("#player");
  if (!playerBox) return;
  lastDetailTitle = t;
  playerBox.innerHTML = `<div class="cin-status">Caut episodul S${season}E${episode}…</div>`;

  const alt = t.name_original && t.name_original !== t.name ? t.name_original : null;
  const queries = [
    `${t.name} S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`,
    `${t.name} ${season} сезон`,
    t.name,
  ];
  let results = null;
  for (const q of queries) {
    try {
      const r = await fetchTorrents(t, q, alt, { noYear: true });
      if (ps !== playSeq) return; // alt episod/versiune ales între timp
      if (r && r.length) {
        results = r;
        break;
      }
    } catch (_) {
      if (ps !== playSeq) return;
    }
  }
  if (!results) {
    playerBox.innerHTML = `<div class="cin-status error">Niciun release găsit pentru S${season}E${episode}. Încearcă din panoul „Versiuni”.</div>`;
    return;
  }
  lastTorrentResults = results;
  buildTorrentsList(t, results);

  // doar pachetele care declară sezonul cerut („S4E1-17”, „3 сезон”); altfel toate
  const packs = results.filter((r) => packMentionsSeason(r.name, season));
  const candidates = (packs.length ? packs : results).slice(0, 3);

  let data = null, chosen = null;
  for (const c of candidates) {
    try {
      const d = await startStream(c, { season, episode });
      if (ps !== playSeq) {
        scheduleDrop(d.hash); // pornit degeaba — ai ales altceva între timp
        if (data) scheduleDrop(data.hash);
        return;
      }
      if (d.matched !== false) {
        // episodul găsit exact: câștigă; fallback-ul ținut până acum se deconectează
        if (data && data.hash !== d.hash) scheduleDrop(data.hash);
        data = d; chosen = c;
        break;
      }
      // fallback = pachetul cu cele mai multe fișiere (probabil conține episodul)
      if (!data || d.files.length > data.files.length) {
        if (data && data.hash !== d.hash) scheduleDrop(data.hash);
        data = d; chosen = c;
      } else if (d.hash !== data.hash) {
        scheduleDrop(d.hash); // candidat încercat și respins
      }
    } catch (_) {
      if (ps !== playSeq) {
        if (data) scheduleDrop(data.hash);
        return;
      }
    }
  }
  if (!data) {
    playerBox.innerHTML = `<div class="cin-status error">Episodul S${season}E${episode} nu a putut fi pornit. Încearcă din panoul „Versiuni”.</div>`;
    return;
  }
  markPlaying(chosen);
  renderPlayer(t, chosen, data, { season, episode, seekTo });
  if (data.matched === false) {
    toast(`S${season}E${episode} nu a fost identificat exact în pachet — alege fișierul din panoul „Versiuni”`, false);
  }
}

async function playTorrent(t, source, { season = null, episode = null, seekTo = null, fileIndex = 0, ps = null } = {}) {
  if (ps == null) {
    // apel direct (clic pe versiune / fișier): pornim în modul cinema
    enterCinema(t);
    ps = beginPlay();
  }
  const playerBox = $("#player");
  if (!playerBox) return;
  playerBox.innerHTML = `<div class="cin-status">Conectez TorrServer…<small>${esc(source.name || "")}</small></div>`;
  markPlaying(source);

  let data;
  try {
    data = await startStream(source, { fileIndex, season, episode });
  } catch (err) {
    if (ps === playSeq)
      playerBox.innerHTML = `<div class="cin-status error">${esc(err.message)}<small>Alege altă versiune din panoul „Versiuni”.</small></div>`;
    return;
  }
  if (ps !== playSeq) {
    scheduleDrop(data.hash); // între timp ai ales altă versiune sau ai închis
    return;
  }

  renderPlayer(t, source, data, { season, episode, seekTo, fileIndex });
}

/* comenzile player-ului (modul cinema) — aceleași pentru torrente și transmisii live */
function playerHtml() {
  return `
    <div class="video-wrap cin-video">
      <video id="video" autoplay playsinline></video>
      <div class="buffer hidden" id="buffer"></div>
      <div class="video-error hidden" id="video-error" role="alert"></div>
      <button class="cin-bigplay hidden" id="c-big" aria-label="Redă">${svg(I.play, 46)}</button>
      <div class="cin-controls">
        <div class="cin-progress" id="c-prog" role="slider" aria-label="Poziție">
          <div class="cin-track"><i class="buf" id="c-buf"></i><i class="played" id="c-played"></i><i class="knob" id="c-knob"></i></div>
          <div class="cin-hover hidden" id="c-hover"></div>
        </div>
        <div class="cin-row">
          <button class="cbtn" id="c-play" title="Pauză / redare (Space)">${svg(I.pause, 26)}</button>
          <button class="cbtn" id="c-back" title="Înapoi 10 s (←)">${svg(I.back10, 24)}</button>
          <button class="cbtn" id="c-fwd" title="Înainte 10 s (→)">${svg(I.fwd10, 24)}</button>
          <button class="cbtn hidden" id="c-prev" title="Episodul anterior">${svg(I.prev, 24)}</button>
          <button class="cbtn hidden" id="c-next" title="Episodul următor">${svg(I.next, 24)}</button>
          <div class="cin-vol">
            <button class="cbtn" id="c-mute" title="Sunet (M)">${svg(I.vol, 24)}</button>
            <input type="range" id="c-vol" min="0" max="1" step="0.05" aria-label="Volum">
          </div>
          <span class="cin-time" id="c-time">0:00 / 0:00</span>
          <span class="cin-grow"></span>
          <button class="cbtn txt" id="c-cc" title="Subtitrări">CC</button>
          <button class="cbtn txt" id="c-speed" title="Viteză">1×</button>
          <button class="cbtn" id="v-pip" title="Picture-in-picture">${svg(I.pip, 22)}</button>
          <button class="cbtn" id="v-full" title="Ecran complet (F / dublu-clic)">${svg(I.full, 24)}</button>
        </div>
      </div>
      <div class="cin-pop hidden" id="c-cc-pop">
        <div class="cin-pop-title">Subtitrări</div>
        <div class="cc-state" id="cc-state">CC…</div>
        <div class="cin-pop-list" id="c-cc-list"></div>
      </div>
      <div class="cin-pop right hidden" id="c-speed-pop">
        <div class="cin-pop-title">Viteză</div>
        <div class="cin-pop-list">${[0.75, 1, 1.25, 1.5, 2]
          .map((r) => `<button data-rate="${r}" class="${r === 1 ? "on" : ""}">${r === 1 ? "Normal" : r + "×"}</button>`)
          .join("")}</div>
      </div>
    </div>`;
}

function renderPlayer(t, source, data, { season = null, episode = null, seekTo = null, fileIndex = null } = {}) {
  const playerBox = $("#player");
  if (!playerBox) return;
  // alive devine false la cleanup (opresc cronometre/poll-uri); onStop: acțiuni de oprire pe server
  const ctx = { alive: true, onStop: [] };
  keepTorrent(data.hash); // același torrent ca înainte (alt fișier din pachet): nu-l deconecta
  playerBox.innerHTML = playerHtml();

  const video = playerBox.querySelector("#video");
  video.src = data.stream_url;

  // rândul de sus: sezon/episod + calitatea versiunii; jos-dreapta: starea torrentului
  const subParts = [];
  if (season != null && episode != null) subParts.push(`S${season} · E${episode}`);
  if (source && source.quality) subParts.push(source.quality);
  if (source && source.dub) subParts.push("dublaj RU");
  $("#cin-sub").textContent = subParts.join(" · ");
  startStatsPoll({ hash: data.hash, size: data.size, name: data.name, quality: source && source.quality });
  ctx.onStop.push(stopStatsPoll);

  // select fișier (în pachete de sezon) — în panoul „Versiuni”, deasupra listei
  const filesBox = $("#cin-files");
  filesBox.innerHTML = data.files.length > 1 ? `<div class="sub-title">Fișiere în acest torrent</div><select id="file-select"></select>` : "";
  const fileSel = filesBox.querySelector("#file-select");
  if (fileSel) {
    const activePos =
      fileIndex != null
        ? fileIndex
        : Math.max(0, data.files.findIndex((f) => f.index === data.index));
    data.files.forEach((f, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = f.name || `Fișier ${i + 1}`;
      o.selected = i === activePos;
      fileSel.appendChild(o);
    });
    fileSel.addEventListener("change", () =>
      playTorrent(t, source, { fileIndex: +fileSel.value })
    );
  }

  // istoric cu sezon/episod real (sau dedus din numele fișierului)
  let s = season, e = episode;
  if (data.name) {
    const m =
      data.name.match(/s0*(\d+)[\s._-]?e0*(\d+)/i) ||
      data.name.match(/(?<!\d)(\d+)x(\d+)(?!\d)/i) ||
      data.name.match(/^0*(\d+)[\s._-]/); // „07. Жуки.S04...” — episod cu prefix
    if (m) {
      if (m[2] != null) {
        s = +m[1];
        e = +m[2];
      } else if (e == null) {
        e = +m[1];
      }
    }
    if (s == null) {
      const ms = data.name.match(/[\s._\-]s0*(\d+)(?!\d)/i); // „...Жуки.S04.2024...”
      if (ms) s = +ms[1];
    }
  }
  const progress = trackProgress(video, t, s, e, ctx);
  let stopNext = () => {};

  // „Urmează": apare cu 30s înainte de final; la final, countdown 8s și auto-avans
  if (s != null && e != null) {
    const nextEp = () => (epsBySeason[s] || []).find((x) => x.episode === e + 1);
    let nextOv = null;
    let countdownTimer = null;
    let cancelled = false;

    const hideNext = () => {
      if (countdownTimer) clearInterval(countdownTimer);
      countdownTimer = null;
      if (nextOv) { nextOv.remove(); nextOv = null; }
    };
    stopNext = hideNext;
    const goNext = () => {
      hideNext();
      if (ctx.alive) playEpisode(t, s, e + 1);
    };
    const showNext = (withCountdown) => {
      const nx = nextEp();
      if (!nx) return;
      hideNext();
      nextOv = document.createElement("div");
      nextOv.className = "next-ep";
      nextOv.innerHTML = `
        <button class="btn" id="next-go">▶ Urmează: ${e + 1}. ${esc(nx.name || "episodul")}</button>
        <span class="next-count" id="next-count"></span>
        <button class="btn ghost small" id="next-cancel" title="Nu avansa">✕ Rămân</button>`;
      playerBox.prepend(nextOv);
      nextOv.querySelector("#next-go").addEventListener("click", goNext);
      nextOv.querySelector("#next-cancel").addEventListener("click", () => {
        cancelled = true;
        hideNext();
      });
      if (withCountdown) {
        let left = 8;
        const countEl = nextOv.querySelector("#next-count");
        countdownTimer = setInterval(() => {
          if (left <= 0) { goNext(); return; }
          countEl.textContent = `auto în ${left--}s`;
        }, 1000);
        countEl.textContent = `auto în ${left--}s`;
      }
    };

    video.addEventListener("timeupdate", () => {
      if (cancelled) return;
      const d = video.duration;
      if (!d) return;
      const remaining = d - video.currentTime;
      if (remaining <= 30 && !nextOv && !countdownTimer) showNext(false);
      else if (remaining > 32 && nextOv && !countdownTimer) hideNext(); // seek înapoi
    });
    // marcarea ca văzut o face trackProgress (pentru filme și episoade deopotrivă)
    video.addEventListener("ended", () => {
      if (ctx.alive && !cancelled && nextEp()) showNext(true);
    });
  }

  // subtitrări: 1) dublaj RU -> nu-i nevoie  2) .srt din arhivă  3) mux MKV cu progres  4) externă
  attachSubtitles(video, t, data, s, e, source || {}, ctx);

  if (seekTo) video.addEventListener("loadedmetadata", () => { video.currentTime = seekTo; }, { once: true });

  // eroare de redare: mesaj clar în loc de ecran negru; un 401 (sesiune expirată) duce la login
  video.addEventListener("error", () => {
    if (!ctx.alive || !video.getAttribute("src")) return;
    const code = video.error ? video.error.code : 0;
    const why =
      code === 4
        ? "Browserul nu poate reda acest fișier (format video/audio nesuportat, des la HEVC sau AC3 pe telefon) sau torrentul nu răspunde."
        : code === 2
          ? "Conexiunea la stream s-a întrerupt."
          : "Fișierul nu a putut fi redat.";
    const box = playerBox.querySelector("#video-error");
    if (box) {
      box.innerHTML = `${esc(why)} Alege altă versiune din panoul „Versiuni”.`;
      box.classList.remove("hidden");
    }
    $("#buffer")?.classList.add("hidden");
    api("/api/health").catch(() => {}); // dacă sesiunea a expirat, api() deschide login-ul
  });

  enhanceVideo(video, {
    ctx,
    prev: s != null && e > 1 ? () => playEpisode(t, s, e - 1) : null,
    // episodul următor: dacă sezonul e încărcat, doar când există; altfel încercăm
    next: s != null && e != null && (!epsBySeason[s] || epsBySeason[s].some((x) => x.episode === e + 1))
      ? () => playEpisode(t, s, e + 1)
      : null,
  });

  playerCleanup = () => {
    progress.save(); // ultima poziție, înainte să dispară player-ul
    ctx.alive = false;
    stopNext();
    ctx.onStop.forEach((fn) => fn()); // ex.: anulează extragerea subtitrărilor pe server
    scheduleDrop(data.hash); // torrentul nu mai descarcă degeaba după ce ai plecat
    try {
      video.pause();
      video.removeAttribute("src"); // închide conexiunea /ts/stream spre TorrServer
      video.load();
    } catch (_) {}
  };
}

/* ---------- subtitrări automate ---------- */
function addRuTrack(video, src, label) {
  const track = document.createElement("track");
  track.kind = "subtitles";
  track.label = label || "Русские субтитры";
  track.srclang = "ru";
  track.src = src;
  track.default = true; // audio EN -> subtitrările RU pornesc singure
  video.appendChild(track);
  track.addEventListener("error", () => console.warn("subtitrare indisponibilă:", src));
  return track;
}

/* peste această mărime nu extragem automat subtitrările din MKV: ffmpeg ar descărca tot
   fișierul (zeci de GB) în paralel cu redarea și ar provoca buffering */
const MUX_AUTO_MAX_BYTES = 4e9;
const fmtGB = (b) => (b / 1e9).toFixed(b >= 1e10 ? 0 : 1) + " GB";

function attachSubtitles(video, t, data, season, episode, source = {}, ctx = { alive: true, onStop: [] }) {
  const ccEl = $("#cc-state");
  const setState = (text, ok) => {
    if (!ccEl) return;
    ccEl.textContent = text;
    ccEl.classList.toggle("on", !!ok);
  };

  // release cu dublaj rusesc — subtitrările nu-și au rostul
  if (source.dub === "RU") {
    setState("dub RU", true);
    return;
  }

  // externă (OpenSubtitles, cu OS_API_KEY) — ultimul fallback
  // onNone: ce facem dacă nici OpenSubtitles nu are (ex. oferim extragerea manuală)
  const tryExternal = (onNone = () => setState("CC: niciuna", false)) => {
    const q = [t.name, season ? `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}` : "", t.year || ""]
      .filter(Boolean)
      .join(" ");
    setState("CC…", false);
    fetch(`/api/subtitles/file?q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.text() : null))
      .then((vtt) => {
        if (!ctx.alive) return;
        if (vtt && vtt.includes("-->")) {
          addRuTrack(video, `/api/subtitles/file?q=${encodeURIComponent(q)}`, "RU");
          setState("CC RU ✓", true);
        } else {
          onNone();
        }
      })
      .catch(() => ctx.alive && onNone());
  };

  // 1) fișier .srt/.ass separat în arhiva torrentului
  const subs = (data.files || []).filter((f) => /\.(srt|ass|ssa|vtt)$/i.test(f.name || ""));
  if (subs.length) {
    const ruSub =
      subs.find((f) => /(^|[^a-z])(ru|rus|russian|русск|перевод|субтитры)([^a-z]|$)/i.test(f.name)) || subs[0];
    addRuTrack(video, `/api/subtitles/embed?url=${encodeURIComponent(ruSub.url)}`, "RU (din release)");
    setState("CC RU ✓", true);
    return;
  }

  // 2) subtitrări muxate în container — ffmpeg le extrage în fundal, cu progres
  if (/\.mkv$/i.test(data.name || "") && data.stream_url) {
    const enc = encodeURIComponent(data.stream_url);
    const statusUrl = `/api/subtitles/mux?url=${enc}`;
    const dataUrl = `/api/subtitles/mux/data?url=${enc}`;
    let started = false;
    // la închidere/altă versiune: oprim ffmpeg pe server (altfel citește tot fișierul degeaba)
    ctx.onStop.push(() => {
      if (started) fetch(statusUrl, { method: "DELETE", keepalive: true }).catch(() => {});
    });
    const poll = async (start = true) => {
      if (!ctx.alive) return; // player închis sau alt fișier ales — oprim verificarea
      try {
        const st = await fetch(start ? statusUrl : `${statusUrl}&start=0`).then((r) => r.json());
        if (!ctx.alive) return;
        if (st.status === "running") started = true;
        if (st.status === "done") {
          addRuTrack(video, dataUrl, "RU");
          setState("CC RU ✓", true);
        } else if (st.status === "running") {
          setState(st.pct > 0 ? `CC… se extrag ${st.pct}%` : "CC… se extrag", false);
          setTimeout(poll, 3000);
        } else if (st.status === "idle") {
          // fișier mare, nimic în cache: încercăm OpenSubtitles, apoi oferim extragerea manuală
          tryExternal(offerManual);
        } else {
          tryExternal();
        }
      } catch (_) {
        if (ctx.alive) tryExternal();
      }
    };
    const offerManual = () => {
      if (!ctx.alive || !ccEl) return;
      setState("CC: niciuna", false);
      const b = document.createElement("button");
      b.className = "btn small ghost";
      b.id = "cc-extract";
      b.title = "ffmpeg descarcă tot fișierul ca să scoată subtitrările — poate încetini redarea";
      b.textContent = `Extrage CC din MKV (${data.size ? fmtGB(data.size) : "fișier mare"})`;
      b.addEventListener("click", () => {
        b.remove();
        setState("CC… se extrag", false);
        poll(true);
      });
      ccEl.after(b);
    };

    if (data.size && data.size <= MUX_AUTO_MAX_BYTES) {
      setState("CC… se extrag", false);
      poll(true); // fișier mic: extragere automată, ca până acum
    } else {
      setState("CC…", false);
      poll(false); // doar verificăm cache-ul / un job deja pornit — fără să pornim ffmpeg
    }
    return;
  }

  tryExternal();
}

/* ---------- player: comenzi proprii (modul cinema) ---------- */
const PLAYER_PREFS_KEY = "cinema-player";
function loadPlayerPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PLAYER_PREFS_KEY)) || {};
  } catch (_) {
    return {};
  }
}
function savePlayerPrefs(p) {
  try {
    localStorage.setItem(PLAYER_PREFS_KEY, JSON.stringify(p));
  } catch (_) {}
}

function enhanceVideo(video, { ctx, prev = null, next = null } = {}) {
  const q = (id) => document.getElementById(id);
  const buffer = q("buffer"), big = q("c-big"), playBtn = q("c-play");
  const prog = q("c-prog"), played = q("c-played"), buf = q("c-buf"), knob = q("c-knob"), hover = q("c-hover");
  const timeEl = q("c-time"), muteBtn = q("c-mute"), vol = q("c-vol");
  const ccBtn = q("c-cc"), ccPop = q("c-cc-pop"), ccList = q("c-cc-list");
  const speedBtn = q("c-speed"), speedPop = q("c-speed-pop");

  // volum + mute ținute minte între filme
  const prefs = loadPlayerPrefs();
  video.volume = prefs.volume != null ? prefs.volume : 1;
  video.muted = !!prefs.muted;
  const syncVol = () => {
    vol.value = video.muted ? 0 : video.volume;
    muteBtn.innerHTML = svg(video.muted || video.volume === 0 ? I.mute : I.vol, 24);
    savePlayerPrefs({ ...loadPlayerPrefs(), volume: video.volume, muted: video.muted });
  };
  vol.addEventListener("input", () => {
    video.volume = +vol.value;
    video.muted = +vol.value === 0;
  });
  muteBtn.addEventListener("click", () => (video.muted = !video.muted));
  video.addEventListener("volumechange", syncVol);
  syncVol();

  // play / pauză
  const toggle = () => (video.paused ? video.play().catch(() => {}) : video.pause());
  const syncPlay = () => {
    playBtn.innerHTML = svg(video.paused ? I.play : I.pause, 26);
    big.classList.toggle("hidden", !video.paused);
    wakeCinemaUi();
  };
  ["play", "pause", "ended"].forEach((ev) => video.addEventListener(ev, syncPlay));
  playBtn.addEventListener("click", toggle);
  big.addEventListener("click", toggle);
  video.addEventListener("click", toggle);
  video.addEventListener("dblclick", () => toggleFull());
  q("c-back").addEventListener("click", () => (video.currentTime = Math.max(0, video.currentTime - 10)));
  q("c-fwd").addEventListener("click", () => (video.currentTime = Math.min(video.duration || 1e9, video.currentTime + 10)));
  if (prev) q("c-prev").classList.remove("hidden"), q("c-prev").addEventListener("click", prev);
  if (next) q("c-next").classList.remove("hidden"), q("c-next").addEventListener("click", next);

  // spinner de buffering
  video.addEventListener("waiting", () => buffer.classList.remove("hidden"));
  ["playing", "canplay", "pause"].forEach((ev) => video.addEventListener(ev, () => buffer.classList.add("hidden")));

  // bara de progres: redat + încărcat în avans (buffer), clic/tragere pentru derulare
  const bufferedEnd = () => {
    const b = video.buffered, t = video.currentTime;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i);
    return t;
  };
  const syncTime = () => {
    const d = Number.isFinite(video.duration) ? video.duration : 0;
    const pct = d ? (video.currentTime / d) * 100 : 0;
    played.style.width = pct + "%";
    knob.style.left = pct + "%";
    buf.style.width = d ? Math.min(100, (bufferedEnd() / d) * 100) + "%" : "0";
    timeEl.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(d)}`;
  };
  ["timeupdate", "progress", "loadedmetadata", "durationchange", "seeked"].forEach((ev) => video.addEventListener(ev, syncTime));
  const fracAt = (ev) => {
    const r = prog.getBoundingClientRect();
    return Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
  };
  let dragging = false;
  const seekTo = (ev) => {
    const d = video.duration;
    if (Number.isFinite(d) && d > 0) {
      video.currentTime = fracAt(ev) * d;
      syncTime();
    }
  };
  prog.addEventListener("pointerdown", (ev) => {
    dragging = true;
    prog.setPointerCapture(ev.pointerId);
    seekTo(ev);
  });
  prog.addEventListener("pointermove", (ev) => {
    const d = video.duration;
    if (Number.isFinite(d) && d > 0) {
      const f = fracAt(ev);
      hover.textContent = fmtTime(f * d);
      hover.style.left = f * 100 + "%";
      hover.classList.remove("hidden");
    }
    if (dragging) seekTo(ev);
  });
  prog.addEventListener("pointerup", () => (dragging = false));
  prog.addEventListener("pointerleave", () => hover.classList.add("hidden"));

  // meniuri: subtitrări + viteză (unul singur deschis odată)
  const closePops = (except) => [ccPop, speedPop].forEach((p) => p !== except && p.classList.add("hidden"));
  const togglePop = (pop) => {
    closePops(pop);
    pop.classList.toggle("hidden");
    if (pop === ccPop && !pop.classList.contains("hidden")) drawCcList();
  };
  const tracks = () => [...video.textTracks].filter((tr) => tr.kind === "subtitles" || tr.kind === "captions");
  const syncCcBtn = () => ccBtn.classList.toggle("on", tracks().some((tr) => tr.mode === "showing"));
  const drawCcList = () => {
    const list = tracks();
    ccList.innerHTML = "";
    const add = (label, on, fn) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.classList.toggle("on", on);
      b.addEventListener("click", () => {
        fn();
        syncCcBtn();
        drawCcList();
      });
      ccList.appendChild(b);
    };
    add("Oprite", !list.some((tr) => tr.mode === "showing"), () => list.forEach((tr) => (tr.mode = "disabled")));
    list.forEach((tr, i) =>
      add(tr.label || `Pista ${i + 1}`, tr.mode === "showing", () =>
        list.forEach((x) => (x.mode = x === tr ? "showing" : "disabled"))
      )
    );
  };
  video.textTracks.addEventListener("addtrack", () => setTimeout(syncCcBtn, 50));
  video.textTracks.addEventListener("change", syncCcBtn);
  ccBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    togglePop(ccPop);
  });
  speedBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    togglePop(speedPop);
  });
  speedPop.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      video.playbackRate = +b.dataset.rate;
      speedBtn.textContent = b.dataset.rate === "1" ? "1×" : `${b.dataset.rate}×`;
      speedPop.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      speedPop.classList.add("hidden");
    })
  );
  [ccPop, speedPop].forEach((p) => p.addEventListener("click", (ev) => ev.stopPropagation()));
  const outside = () => closePops(null);
  document.addEventListener("click", outside);
  ctx.onStop.push(() => document.removeEventListener("click", outside));

  // PiP + ecran complet (pe tot stratul cinema, ca și comenzile să rămână vizibile)
  q("v-full").addEventListener("click", () => toggleFull());
  q("v-pip").addEventListener("click", async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch (_) {
      toast("PiP indisponibil", false);
    }
  });
  document.addEventListener("keydown", playerKeysHandler);
  syncPlay();
  syncTime();
}

function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else (cinemaOpen() ? cinema : $("#video"))?.requestFullscreen?.().catch(() => {});
}
document.addEventListener("fullscreenchange", () => {
  const b = $("#v-full");
  if (b) b.innerHTML = svg(document.fullscreenElement ? I.unfull : I.full, 24);
});

function playerKeysHandler(e) {
  const video = $("#video");
  if (!video || !cinemaOpen()) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  const tag = (t.tagName || "").toUpperCase();
  if (["INPUT", "SELECT", "TEXTAREA"].includes(tag) && t.id !== "c-vol") return;
  // butoanele din afara barei de control (panou, listă) își păstrează Space/Enter
  if ((tag === "BUTTON" || (t.getAttribute && t.getAttribute("role") === "button")) && !t.closest(".cin-controls")) return;
  const k = e.key.toLowerCase();
  if (e.key === " " || k === "k") {
    e.preventDefault();
    video.paused ? video.play().catch(() => {}) : video.pause();
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    video.currentTime = Math.min(video.duration || 1e9, video.currentTime + 10);
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    video.currentTime = Math.max(0, video.currentTime - 10);
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    video.muted = false;
    video.volume = Math.min(1, Math.max(0, video.volume + (e.key === "ArrowUp" ? 0.1 : -0.1)));
  } else if (k === "f") {
    toggleFull();
  } else if (k === "m") {
    video.muted = !video.muted;
  } else if (k === "n") {
    $("#c-next:not(.hidden)")?.click();
  } else if (k === "p") {
    $("#c-prev:not(.hidden)")?.click();
  }
}

/* ---------- istoric progres ---------- */
/* salvarea progresului pentru player-ul curent (folosită la ascunderea/închiderea paginii) */
let currentProgressSave = null;

function trackProgress(video, t, season, episode, ctx) {
  let lastAt = 0;
  let lastPos = -1;
  const send = (pos, dur) =>
    !t.id // torrent pornit din „Căutare torrente” (fără titlu în catalog): nu are istoric
      ? Promise.resolve()
      :
    api("/api/history", {
      method: "POST",
      keepalive: true, // ajunge la server chiar dacă pagina se închide
      body: JSON.stringify({
        title_id: t.id,
        season: season ?? null,
        episode: episode ?? null,
        position_seconds: pos,
        duration_seconds: dur || null,
      }),
    }).catch(() => {});

  // force: la pauză/închidere; altfel cel mult o dată la 10s în timpul redării
  const save = (force = false) => {
    if (!ctx.alive || video.ended) return;
    const pos = video.currentTime;
    if (!(pos >= 5)) return;
    if (!force && Date.now() - lastAt < 10000) return;
    if (Math.abs(pos - lastPos) < (force ? 0.25 : 1)) return; // nimic nou de salvat
    lastAt = Date.now();
    lastPos = pos;
    const dur = Number.isFinite(video.duration) ? video.duration : null;
    send(pos, dur);
  };

  video.addEventListener("timeupdate", () => save(false));
  video.addEventListener("pause", () => save(true));
  // la final: văzut complet (filmele dispar din „Continuă”, episoadele primesc „văzut”)
  video.addEventListener("ended", () => {
    if (!ctx.alive) return;
    const dur = Number.isFinite(video.duration) ? video.duration : video.currentTime;
    lastPos = dur;
    send(dur, dur);
  });

  const api_ = { save: () => save(true) };
  currentProgressSave = api_.save;
  return api_;
}

/* ================= init ================= */
(async () => {
  // login: Enter în câmp + click pe buton
  $("#login-btn").addEventListener("click", tryLogin);
  $("#login-pass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryLogin();
  });
  try {
    const items = await api("/api/watchlist");
    state.watchlist = new Set(items.map((i) => i.title.id));
    items.forEach((i) => (state.wlStatus[i.title.id] = i.status));
  } catch (_) {}
  try {
    state.history = await api("/api/history");
  } catch (_) {}
  render();
})();
