/* Cinema — utilitare, login, toast, iconițe, skeletoane, carduri.
   Scripturi clasice încărcate în ordine (index.html): împart același spațiu global. */
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
    let msg = "Parolă greșită";
    try {
      msg = (await r.json()).detail || msg; // ex. „mai ai 3 încercări” / blocare temporară
    } catch (_) {}
    err.textContent = msg;
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
/* steagul campionatului (flagcdn.com; emoji-urile de steag nu se randează pe Windows) */
function flagImg(code) {
  return code ? `<img class="flag" src="https://flagcdn.com/w40/${esc(code)}.png" alt="" loading="lazy">` : "";
}
/* țara (RGFootball, în engleză) -> cod flagcdn; competițiile UEFA -> steagul UE */
const SP_FLAG_CODES = {
  england: "gb-eng", germany: "de", italy: "it", spain: "es", france: "fr",
  portugal: "pt", netherlands: "nl", scotland: "gb-sct", turkey: "tr", turkiye: "tr",
  russia: "ru", ukraine: "ua", belgium: "be", brazil: "br", argentina: "ar", usa: "us",
};
function spFlag(m) {
  return SP_FLAG_CODES[(m.country || "").toLowerCase()] ||
    (/uefa|champions league|europa league/i.test(m.competition || "") ? "eu" : "");
}
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
  resync: "M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z",
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
  if (h.next) return `Urmează: S${h.next.season} · E${h.next.episode}`; // episodul de acum e terminat
  const ep = h.season ? `S${h.season} · E${h.episode} · ` : "";
  const left = Math.max(0, (h.duration_seconds || 0) - (h.position_seconds || 0));
  const mins = Math.round(left / 60);
  return ep + (mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min rămase` : `${Math.max(1, mins)} min rămase`);
}
// început (>30s) dar neterminat (>1 min rămas); un film văzut până la capăt dispare din „Continuă”
const isUnfinished = (h) =>
  h.position_seconds > 30 && (h.duration_seconds == null || h.duration_seconds - h.position_seconds > 60);
// la seriale, episodul abia pornit e „unde ești” (ai trecut la următorul): apare de la primele
// secunde salvate; la filme rămâne pragul de 30 s (filme deschise din greșeală)
const isEpisodeInProgress = (h) =>
  h.episode != null && h.position_seconds >= 5 && !!h.duration_seconds && h.duration_seconds - h.position_seconds > 60;
// + episod terminat cu un următor (serverul îl pune în h.next): „Urmează: S2 · E13”
const isContinuable = (h) =>
  !!h.title && (!!h.next || (!!h.duration_seconds && (isUnfinished(h) || isEpisodeInProgress(h))));
const isFinishedEp = (h) => !!h.duration_seconds && h.duration_seconds - h.position_seconds <= 60;
/* episodul de după (s, e), din sezoanele TMDB [{season, episodes}]; sezonul 0 (speciale) nu contează */
function nextEpisodeOf(seasons, s, e) {
  const counts = new Map((seasons || []).filter((x) => x.season).map((x) => [+x.season, +x.episodes || 0]));
  if (e < (counts.get(s) || 0)) return { season: s, episode: e + 1 };
  const later = [...counts].filter(([n, c]) => n > s && c > 0).map(([n]) => n).sort((a, b) => a - b);
  return later.length ? { season: later[0], episode: 1 } : null;
}

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
