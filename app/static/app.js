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

function esc(s) {
  return String(s == null ? "" : s).replace(/</g, "&lt;");
}
function escUrl(s) {
  return String(s == null ? "" : s).replace(/"/g, "&quot;");
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

  div.innerHTML = `
    <div class="card-poster">
      ${title.poster
        ? `<img loading="lazy" src="${escUrl(title.poster)}">`
        : `<div class="noimg">${esc(title.name)}</div>`}
      ${rating ? `<div class="card-rate ${Number(title.rating) < 5 ? "low" : ""}">${rating}</div>` : ""}
      ${title.source ? `<div class="card-tag">${esc(title.source === "tmdb" ? "TMDB" : title.source)}</div>` : ""}
      ${progress}
    </div>
    <div class="card-name">${esc(title.name)}</div>
    ${title.year ? `<div class="card-sub">${esc(title.year)} ${title.type === "series" ? "· serial" : title.type === "movie" ? "· film" : ""}</div>` : ""}
  `;
  div.querySelector(".card-poster").addEventListener("click", () => openDetail(title));
  div.querySelector(".card-name").addEventListener("click", () => openDetail(title));
  return div;
}

function rowEl(titleText, titles, opts = {}) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<div class="row-title"><div>${esc(titleText)}</div></div>`;
  const scroll = document.createElement("div");
  scroll.className = "row-scroll";
  titles.forEach((t, i) =>
    scroll.appendChild(
      cardEl(t, {
        progress: opts.histories && opts.histories[i] ? opts.histories[i].position_seconds : 0,
        duration: opts.histories && opts.histories[i] ? opts.histories[i].duration_seconds : 0,
      })
    )
  );
  if (opts.onMore) {
    const b = document.createElement("button");
    b.className = "row-more";
    b.textContent = "Toate →";
    b.addEventListener("click", opts.onMore);
    row.querySelector(".row-title").appendChild(b);
  }
  row.appendChild(scroll);
  return row;
}

/* ================= routing (hash) ================= */
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  const seg = h.split("/").filter(Boolean);
  if (!seg.length) return { view: "home" };
  if (seg[0] === "browse") return { view: "browse", category: seg[1] === "series" ? "series" : "films" };
  if (seg[0] === "search") return { view: "searchpage", q: decodeURIComponent(seg.slice(1).join("/")) };
  if (seg[0] === "watchlist") return { view: "watchlist" };
  if (seg[0] === "continue") return { view: "continue" };
  if (seg[0] === "downloads") return { view: "downloads" };
  return { view: "home" };
}
function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}
window.addEventListener("hashchange", render);

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    const v = btn.dataset.view;
    if (v === "search") {
      openSearch();
      return;
    }
    go(v === "home" ? "#/" : `#/${v}`);
  });
});

function setNavActive(view) {
  document.querySelectorAll(".nav-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view)
  );
}

async function render() {
  const r = parseRoute();
  setNavActive(r.view === "browse" || r.view === "searchpage" ? "home" : r.view);
  closeSearch();
  closeDetail();
  window.scrollTo(0, 0);

  if (r.view === "home") return loadHome();
  if (r.view === "browse") return loadBrowse(r.category);
  if (r.view === "searchpage") return loadSearchPage(r.q);
  if (r.view === "watchlist") return loadWatchlist();
  if (r.view === "continue") return loadContinue();
  if (r.view === "downloads") return loadDownloads();
  return loadHome();
}

/* ================= HOME ================= */
async function loadHome() {
  content.innerHTML = `<div class="hero-skel skel" style="min-height:380px"></div><div class="rows">${skelRows(2)}</div>`;
  let films, series;
  try {
    [films, series, state.history] = await Promise.all([
      api("/api/browse?category=films").then((d) => d.results || []),
      api("/api/browse?category=series").then((d) => d.results || []),
      api("/api/history").catch(() => state.history),
    ]);
  } catch (err) {
    content.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}<br><button class="btn ghost" style="margin-top:1rem" onclick="location.reload()">Reîncearcă</button></div>`;
    return;
  }

  content.innerHTML = "";

  const heroTitle = films[0];
  if (heroTitle) {
    const hero = document.createElement("section");
    hero.className = "hero";
    hero.innerHTML = `
      <div class="hero-backdrop" style="background-image:url('${escUrl(heroTitle.poster)}')"></div>
      <div class="hero-inner">
        <div class="hero-poster">${heroTitle.poster ? `<img src="${escUrl(heroTitle.poster)}">` : ""}</div>
        <div class="hero-info">
          <div class="hero-title">${esc(heroTitle.name)}</div>
          <div class="hero-meta">
            ${heroTitle.rating ? `<span class="stars">★ ${Number(heroTitle.rating).toFixed(1)}</span>` : ""}
            ${heroTitle.year ? `<span>${esc(heroTitle.year)}</span>` : ""}
            <span>film</span>
          </div>
          <div class="hero-actions">
            <button class="btn" id="hero-play">${svg(I.play)} Detalii</button>
            <button class="btn ghost" id="hero-wl">${svg(I.star, 16)} ${state.watchlist.has(heroTitle.id) ? "În watchlist" : "Watchlist"}</button>
          </div>
        </div>
      </div>
    `;
    content.appendChild(hero);
    hero.querySelector("#hero-play").addEventListener("click", () => openDetail(heroTitle));
    hero.querySelector("#hero-wl").addEventListener("click", async () => {
      const on = await toggleWatchlist(heroTitle);
      hero.querySelector("#hero-wl").innerHTML = `${svg(I.star, 16)} ${on ? "În watchlist" : "Watchlist"}`;
    });
  }

  const rows = document.createElement("div");
  rows.className = "rows";
  content.appendChild(rows);

  const continuable = state.history.filter(
    (h) => h.position_seconds > 30 && h.title && (h.duration_seconds || 0) > h.position_seconds
  );
  if (continuable.length) {
    rows.appendChild(
      rowEl("Continuă vizionarea", continuable.map((h) => h.title), { histories: continuable })
    );
  }
  rows.appendChild(rowEl("Filme populare", films.slice(1), { onMore: () => go("#/browse/films") }));
  rows.appendChild(rowEl("Seriale populare", series, { onMore: () => go("#/browse/series") }));
}

/* ================= BROWSE (cu filtre) ================= */
const browseState = { category: "films", page: 1, genre: "", year: "", sort: "popularity", items: [], done: false, loading: false };

async function loadBrowse(category) {
  Object.assign(browseState, { category, page: 1, genre: "", year: "", sort: "popularity", items: [], done: false });
  content.innerHTML = `
    <div class="grid-wrap">
      <div class="view-title">${category === "series" ? "Seriale" : "Filme"}</div>
      <div class="filter-bar" id="filter-bar">
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

  try {
    const genres = await api(`/api/genres?category=${category}`);
    const gSel = $("#f-genre");
    genres.forEach((g) => {
      const o = document.createElement("option");
      o.value = g.id;
      o.textContent = g.name;
      gSel.appendChild(o);
    });
  } catch (_) {}

  const apply = () => {
    browseState.genre = $("#f-genre").value;
    browseState.year = $("#f-year").value;
    browseState.sort = $("#f-sort").value;
    browseState.page = 1;
    browseState.items = [];
    browseState.done = false;
    $("#browse-grid").innerHTML = "";
    fetchBrowsePage();
  };
  ["#f-genre", "#f-year", "#f-sort"].forEach((id) => $(id).addEventListener("change", apply));
  $("#load-more").addEventListener("click", fetchBrowsePage);
  fetchBrowsePage();
}

async function fetchBrowsePage() {
  if (browseState.loading || browseState.done) return;
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
    const res = data.results || [];
    if (first) $("#browse-grid").innerHTML = "";
    const grid = $("#browse-grid");
    res.forEach((t) => {
      browseState.items.push(t);
      grid.appendChild(cardEl(t));
    });
    browseState.done = res.length < 20;
    if (!browseState.items.length && first)
      grid.innerHTML = `<div class="status">Nimic pentru filtrele alese.</div>`;
  } catch (err) {
    $("#browse-grid").innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
    browseState.done = true;
  } finally {
    browseState.loading = false;
    if (btn) {
      btn.disabled = false;
      btn.classList.toggle("hidden", browseState.done);
    }
    browseState.page++;
  }
}

/* ================= WATCHLIST ================= */
const WL_LABELS = { to_watch: "De văzut", watching: "În curs", watched: "Văzut" };

async function loadWatchlist() {
  content.innerHTML = `<div class="grid-wrap"><div class="view-title">Watchlist</div>${skelGrid(6)}</div>`;
  let items;
  try {
    items = await api("/api/watchlist");
  } catch (err) {
    content.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
    return;
  }
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
  content.innerHTML = `<div class="grid-wrap"><div class="view-title">Continuă vizionarea</div>${skelGrid(6)}</div>`;
  try {
    state.history = await api("/api/history");
  } catch (err) {
    content.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "grid-wrap";
  const live = state.history.filter(
    (h) => h.position_seconds > 30 && h.title && (h.duration_seconds || 0) > h.position_seconds
  );
  wrap.innerHTML = `<div class="view-title">Continuă vizionarea (${live.length})</div>`;
  if (!live.length) {
    wrap.innerHTML += `<div class="status">Niciun titlu în curs de vizionare.</div>`;
  } else {
    const grid = document.createElement("div");
    grid.className = "grid";
    live.forEach((h) => {
      const c = cardEl(h.title, { progress: h.position_seconds, duration: h.duration_seconds });
      const sub = document.createElement("div");
      sub.className = "card-sub";
      sub.textContent =
        (h.season ? `S${h.season}E${h.episode} · ` : "") + fmtTime(h.position_seconds) + " / " + fmtTime(h.duration_seconds);
      c.appendChild(sub);
      grid.appendChild(c);
    });
    wrap.appendChild(grid);
  }
  content.innerHTML = "";
  content.appendChild(wrap);
}

/* ================= DESCĂRCĂRI (cache TorrServer) ================= */
async function loadDownloads() {
  content.innerHTML = `<div class="grid-wrap"><div class="view-title">Descărcări (cache TorrServer)</div><div class="status">Se încarcă...</div></div>`;
  let items;
  try {
    items = await api("/api/downloads");
  } catch (err) {
    content.innerHTML = `<div class="status error">${esc(err.message)}</div>`;
    return;
  }
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
    if (q.length < 2) return;
    const box = $("#search-results");
    box.innerHTML = `<div class="status">Se caută...</div>`;
    try {
      const { results, errors } = await api(`/api/search?q=${encodeURIComponent(q)}`);
      box.innerHTML = "";
      if (!results.length) {
        box.innerHTML = `<div class="status">${errors.length ? esc(errors[0]) : "Niciun rezultat."}</div>`;
        return;
      }
      results.forEach((t) => box.appendChild(cardEl(t)));
    } catch (err) {
      box.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
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
  content.innerHTML = `<div class="grid-wrap"><div class="view-title">Rezultate pentru „${esc(q)}"</div>${skelGrid(8)}</div>`;
  try {
    const { results, errors } = await api(`/api/search?q=${encodeURIComponent(q)}`);
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
    content.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
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

$("#modal-close").addEventListener("click", closeDetail);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeDetail();
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

function closeDetail() {
  modal.classList.add("hidden");
  modalBody.innerHTML = "";
  document.removeEventListener("keydown", playerKeysHandler);
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeDetail();
    closeSearch();
  }
});

async function openDetail(title, opts = {}) {
  modal.classList.remove("hidden");
  modalBody.innerHTML = `<div class="status">Se încarcă...</div>`;
  let detail;
  try {
    detail = await api(`/api/title/${title.id}?_=${Date.now()}`);
  } catch (err) {
    modalBody.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
    return;
  }
  renderModal(detail, opts);
}

function chipsHtml(t) {
  return `
    ${t.year ? `<span>${esc(t.year)}</span>` : ""}
    ${t.type === "series" ? "<span>serial</span>" : t.type === "movie" ? "<span>film</span>" : ""}
    ${t.rating ? `<span>★ ${Number(t.rating).toFixed(1)}</span>` : ""}
    <span>TMDB</span>
  `;
}

function renderModal(t, opts = {}) {
  epsBySeason = {}; // cache episoade per titlu deschis
  const isSeries = t.type === "series";
  const inWl = state.watchlist.has(t.id);

  modalBody.innerHTML = `
    <div class="modal-head">
      <div class="modal-backdrop" style="background-image:url('${escUrl(t.poster)}')"></div>
      <div class="modal-head-inner">
        <div class="modal-poster">${t.poster ? `<img src="${escUrl(t.poster)}">` : ""}</div>
        <div class="modal-info">
          <h2>${esc(t.name)}</h2>
          ${t.name_original ? `<div class="modal-original">${esc(t.name_original)}</div>` : ""}
          <div class="modal-chips">${chipsHtml(t)}</div>
          ${t.description ? `<div class="modal-desc" id="desc">${esc(t.description)}</div>` : ""}
        </div>
      </div>
    </div>

    <div class="modal-actions">
      ${isSeries ? "" : `<button class="btn" id="m-play">${svg(I.play)} Redă</button>`}
      ${isSeries ? `<button class="btn" id="m-eps">${svg(I.play)} Episoade</button>` : ""}
      <button class="btn ghost" id="m-wl">${svg(I.star, 16)} ${inWl ? "În watchlist" : "Watchlist"}</button>
      ${t.trailer ? `<button class="btn ghost" id="m-trailer">${svg(I.yt, 16)} Trailer</button>` : ""}
      ${inWl ? `<span class="seg" id="m-seg">
        ${Object.entries(WL_LABELS)
          .map(([v, l]) => `<button data-v="${v}" class="${state.wlStatus[t.id] === v ? "on" : ""}">${l}</button>`)
          .join("")}
      </span>` : ""}
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
  `;

  const descEl = modalBody.querySelector("#desc");
  if (descEl) descEl.addEventListener("click", () => descEl.classList.toggle("expanded"));

  modalBody.querySelector("#m-wl").addEventListener("click", async () => {
    const on = await toggleWatchlist(t);
    modalBody.querySelector("#m-wl").innerHTML = `${svg(I.star, 16)} ${on ? "În watchlist" : "Watchlist"}`;
    renderModal(t, { keepTab: currentTab() });
  });
  const trailerBtn = modalBody.querySelector("#m-trailer");
  if (trailerBtn) {
    trailerBtn.addEventListener("click", () => playTrailer(t));
  }
  const seg = modalBody.querySelector("#m-seg");
  if (seg) {
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
  function currentTab() {
    const on = modalBody.querySelector("#m-tabs button.on");
    return on ? on.dataset.tab : "play";
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

  // resume
  (async () => {
    try {
      const hist = await api(`/api/title/${t.id}/history`);
      const last = hist.find((h) => h.position_seconds > 30);
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

  if (!isSeries && !opts.noAutoplay) autoPlayBest(t, opts.seekTo || null);
}

/* ---------- trailer în modal (embed, nu fereastră nouă) ---------- */
function playTrailer(t) {
  const playerBox = modalBody.querySelector("#player");
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
  const video = modalBody.querySelector("#video");
  const resumeAt = video && video.currentTime > 15 ? video.currentTime : null;
  if (video) video.pause();

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
  modalBody.querySelector("#torrents").classList.add("hidden");
  const pill = modalBody.querySelector("#pill");
  if (pill) pill.classList.add("hidden");

  playerBox.querySelector("#trailer-back").addEventListener("click", () => {
    modalBody.querySelector("#torrents").classList.remove("hidden");
    if (pill) pill.classList.remove("hidden");
    if (t.type === "series") {
      playerBox.innerHTML = `<div class="status" style="padding:1rem">Alege un episod din tabul „Episoade”.</div>`;
      const epsTab = modalBody.querySelector("#m-tabs button[data-tab='eps']");
      if (epsTab) epsTab.click();
    } else if (resumeAt) {
      autoPlayBest(t, resumeAt);
    } else {
      autoPlayBest(t);
    }
  });
  setTimeout(updateModalFade, 250);
}

/* ---------- tab Detalii: cast + similar ---------- */
function renderInfoTab(t) {
  const panel = modalBody.querySelector("#tab-info");
  if (!panel) return;
  const castHtml = (t.cast || [])
    .map(
      (c) => `<div class="cast-chip">
        ${c.profile ? `<img src="${escUrl(c.profile)}" loading="lazy">` : `<div class="cast-noimg">${svg(I.info, 20)}</div>`}
        <div><div class="cast-name">${esc(c.name)}</div><div class="cast-char">${esc(c.character || "")}</div></div>
      </div>`
    )
    .join("");
  const similar = t.similar || [];
  panel.innerHTML = `
    ${t.description ? `<div class="info-desc">${esc(t.description)}</div>` : ""}
    ${castHtml ? `<div class="sub-title">Distribuție</div><div class="cast-row">${castHtml}</div>` : ""}
    ${similar.length ? `<div class="sub-title">Titluri similare</div><div class="similar-row" id="similar-row"></div>` : ""}
  `;
  const row = panel.querySelector("#similar-row");
  if (row) similar.forEach((h) => row.appendChild(cardEl(h)));
}

/* ---------- tab Episoade: sezoane din TMDB, episoade încărcate leneș per sezon ---------- */
let epsBySeason = {}; // season -> [episoade] (pentru „Urmează")

async function renderEpisodesTab(t) {
  const panel = modalBody.querySelector("#tab-eps");
  if (!panel) return;
  panel.innerHTML = `<div class="status">Se încarcă sezoanele...</div>`;
  let hist = [];
  try {
    hist = await api(`/api/title/${t.id}/history`);
  } catch (_) {}
  const byEp = new Map(hist.map((h) => [`${h.season}x${h.episode}`, h]));

  // sezoanele: din TMDB (t.seasons) sau din episoadele deja în DB (fallback)
  let seasons = (t.seasons || []).map((s) => s.season).filter((s) => s != null);
  if (!seasons.length) seasons = [...new Set((t.episodes || []).map((e) => e.season))].sort((a, b) => a - b);
  if (!seasons.length) {
    panel.innerHTML = `<div class="status">Niciun sezon găsit.</div>`;
    return;
  }
  const initialSeason = seasons.includes(1) ? 1 : seasons[seasons.length - 1];
  panel.innerHTML = `
    <div class="season-chips" id="season-chips">
      ${seasons.map((s) => `<button data-s="${s}" class="${s === initialSeason ? "on" : ""}">Sezonul ${s}</button>`).join("")}
    </div>
    <div class="eps-grid" id="eps-grid"></div>`;

  const grid = panel.querySelector("#eps-grid");
  const CHUNK = 24;

  async function loadSeason(s) {
    if (!epsBySeason[s]) {
      grid.innerHTML = `<div class="status">Se încarcă sezonul ${s}...</div>`;
      try {
        epsBySeason[s] = await api(`/api/title/${t.id}/episodes?season=${s}`);
      } catch (_) {
        epsBySeason[s] = (t.episodes || []).filter((e) => e.season === s); // fallback din DB
      }
    }
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
            ${e.still ? `<img loading="lazy" src="${escUrl(e.still)}">` : `<div class="noimg">S${e.season}E${e.episode}</div>`}
            <div class="ep-play">${svg(I.play, 26)}</div>
            ${watched}
          </div>
          <div class="ep-name">${e.episode}. ${esc(e.name || "Episodul " + e.episode)}</div>`;
        el.addEventListener("click", () => playEpisode(t, e.season, e.episode));
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

async function autoPlayBest(t, seekTo = null) {
  lastDetailTitle = t;
  const playerBox = modalBody.querySelector("#player");
  if (!playerBox) return;
  playerBox.innerHTML = `<div class="status" style="padding:1rem">Caut release-ul potrivit...</div>`;
  const q = t.name_original || t.name;
  const alt = t.name_original && t.name_original !== t.name ? t.name : null;
  let results;
  try {
    results = await fetchTorrents(t, q, alt);
  } catch (err) {
    playerBox.innerHTML = `<div class="status error">${esc(err.message)}</div>`;
    return;
  }
  lastTorrentResults = results;
  buildTorrentsList(t, results);
  await playTorrent(t, results[0], { seekTo });
  pillShow(results[0]);
}

function buildTorrentsList(t, results) {
  const box = modalBody.querySelector("#torrents");
  if (!box) return;
  box.innerHTML = `<div class="sub-title">Versiuni (${results.length})</div>
    <div class="torrent-list">${results
      .map(
        (r, i) => `
      <div class="torrent-row" data-i="${i}">
        <div class="t-name">${esc(r.name)}
          <div class="t-meta">${r.dub ? `<b class="ru-badge">RU</b> ` : ""}${esc(r.size || "?")}${r.seeds ? " · 🌱" + r.seeds : ""}${r.quality ? " · " + esc(r.quality) : ""} · [${esc(r.indexer || r.source || "?")}]</div>
        </div>
        <button class="btn-play">${svg(I.play, 14)}</button>
      </div>`
      )
      .join("")}</div>`;
  box.querySelectorAll(".torrent-row").forEach((row) =>
    row.addEventListener("click", () => {
      playTorrent(t, results[+row.dataset.i], {});
      pillShow(results[+row.dataset.i]);
    })
  );
}

function pillShow(source) {
  const pill = modalBody.querySelector("#pill");
  if (!pill) return;
  pill.classList.remove("hidden");
  const short = (source.name || "").replace(/\s+/g, " ").slice(0, 70);
  pill.innerHTML = `
    <span class="pill-tag">AUTO</span>
    ${esc(short)}${source.name && source.name.length > 70 ? "…" : ""}
    <span class="dot">·</span> [${esc(source.indexer || source.source || "?")}]
    ${source.dub ? `<span class="dot">·</span> <b class="ru-badge">RU</b>` : ""}
    ${source.quality ? `<span class="dot">·</span> ${esc(source.quality)}` : ""}
    ${source.seeds ? `<span class="dot">·</span> 🌱${source.seeds}` : ""}`;
}

/* caută release-uri pentru un episod și rulează pachetul potrivit sezonului */
async function playEpisode(t, season, episode, seekTo = null) {
  const playerBox = modalBody.querySelector("#player");
  if (!playerBox) return;
  const tabs = modalBody.querySelector("#m-tabs button[data-tab='play']");
  if (tabs) tabs.click();
  lastDetailTitle = t;
  playerBox.innerHTML = `<div class="status" style="padding:1rem">Caut episodul S${season}E${episode}...</div>`;

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
      if (r && r.length) {
        results = r;
        break;
      }
    } catch (_) {}
  }
  if (!results) {
    playerBox.innerHTML = `<div class="status error">Niciun release găsit pentru S${season}E${episode}. Încearcă din „Versiuni”.</div>`;
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
      // fallback = pachetul cu cele mai multe fișiere (probabil conține episodul)
      if (!data || d.files.length > data.files.length) { data = d; chosen = c; }
      if (d.matched !== false) { data = d; chosen = c; break; }
    } catch (_) {}
  }
  if (!data) {
    playerBox.innerHTML = `<div class="status error">Episodul S${season}E${episode} nu a putut fi pornit. Încearcă din „Versiuni”.</div>`;
    return;
  }
  pillShow(chosen);
  renderPlayer(t, chosen, data, { season, episode, seekTo });
  if (data.matched === false) {
    toast(`S${season}E${episode} nu a fost identificat exact în pachet — alege fișierul din lista de sub player`, false);
  }
}

async function playTorrent(t, source, { season = null, episode = null, seekTo = null, fileIndex = 0 } = {}) {
  const playerBox = modalBody.querySelector("#player");
  if (!playerBox) return;
  playerBox.innerHTML = `<div class="status" style="padding:1rem">Conectez TorrServer...</div>`;

  let data;
  try {
    data = await startStream(source, { fileIndex, season, episode });
  } catch (err) {
    playerBox.innerHTML = `<div class="status error">${esc(err.message)}</div>`;
    return;
  }

  renderPlayer(t, source, data, { season, episode, seekTo, fileIndex });
}

function renderPlayer(t, source, data, { season = null, episode = null, seekTo = null, fileIndex = null } = {}) {
  const playerBox = modalBody.querySelector("#player");
  if (!playerBox) return;
  playerBox.innerHTML = `
    <div class="video-wrap">
      <video id="video" controls autoplay playsinline></video>
      <div class="buffer hidden" id="buffer"></div>
      <div class="video-extra">
        <span class="cc-state" id="cc-state" title="Subtitrări rusești">CC…</span>
        <button class="btn small ghost" id="v-pip" title="Picture-in-picture">${svg(I.pip, 15)} PiP</button>
        <button class="btn small ghost" id="v-full" title="Fullscreen (F / dublu-click)">${svg(I.full, 15)} Full</button>
      </div>
    </div>
    ${data.files.length > 1 ? `<select id="file-select"></select>` : ""}`;

  const video = playerBox.querySelector("#video");
  video.src = data.stream_url;

  // select fișier (în pachete de sezon) — poziții în array; cel activ = fișierul redat
  const fileSel = playerBox.querySelector("#file-select");
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
  trackProgress(video, t, s, e);

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
    const goNext = () => {
      hideNext();
      playEpisode(t, s, e + 1);
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
    video.addEventListener("ended", () => {
      // marchează episodul ca văzut complet
      api("/api/history", {
        method: "POST",
        body: JSON.stringify({
          title_id: t.id, season: s, episode: e,
          position_seconds: video.duration || 1, duration_seconds: video.duration || null,
        }),
      }).catch(() => {});
      if (!cancelled && nextEp()) showNext(true);
    });
  }

  // subtitrări: 1) dublaj RU -> nu-i nevoie  2) .srt din arhivă  3) mux MKV cu progres  4) externă
  attachSubtitles(video, t, data, s, e, source || {});

  if (seekTo) video.addEventListener("loadedmetadata", () => { video.currentTime = seekTo; }, { once: true });

  enhanceVideo(video);
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

function attachSubtitles(video, t, data, season, episode, source = {}) {
  const ccEl = modalBody.querySelector("#cc-state");
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
  const tryExternal = () => {
    const q = [t.name, season ? `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}` : "", t.year || ""]
      .filter(Boolean)
      .join(" ");
    setState("CC…", false);
    fetch(`/api/subtitles/file?q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.text() : null))
      .then((vtt) => {
        if (vtt && vtt.includes("-->")) {
          addRuTrack(video, `/api/subtitles/file?q=${encodeURIComponent(q)}`, "RU");
          setState("CC RU ✓", true);
        } else {
          setState("CC: niciuna", false);
        }
      })
      .catch(() => setState("CC: niciuna", false));
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
    const statusUrl = `/api/subtitles/mux?url=${encodeURIComponent(data.stream_url)}`;
    const dataUrl = `/api/subtitles/mux/data?url=${encodeURIComponent(data.stream_url)}`;
    const poll = async () => {
      try {
        const st = await fetch(statusUrl).then((r) => r.json());
        if (st.status === "done") {
          addRuTrack(video, dataUrl, "RU");
          setState("CC RU ✓", true);
        } else if (st.status === "running") {
          setState(st.pct > 0 ? `CC… se extrag ${st.pct}%` : "CC… se extrag", false);
          setTimeout(poll, 3000);
        } else {
          tryExternal();
        }
      } catch (_) {
        tryExternal();
      }
    };
    setState("CC… se extrag", false);
    poll();
    return;
  }

  tryExternal();
}

/* ---------- player: taste, PiP, fullscreen, spinner ---------- */
function enhanceVideo(video) {
  const buffer = modalBody.querySelector("#buffer");
  video.addEventListener("waiting", () => buffer && buffer.classList.remove("hidden"));
  ["playing", "canplay", "pause"].forEach((ev) =>
    video.addEventListener(ev, () => buffer && buffer.classList.add("hidden"))
  );
  video.addEventListener("dblclick", () => toggleFull(video));
  modalBody.querySelector("#v-full")?.addEventListener("click", () => toggleFull(video));
  modalBody.querySelector("#v-pip")?.addEventListener("click", async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch (_) {
      toast("PiP indisponibil", false);
    }
  });
  document.addEventListener("keydown", playerKeysHandler);
}

function toggleFull(video) {
  if (document.fullscreenElement) document.exitFullscreen();
  else video.requestFullscreen?.();
}

function playerKeysHandler(e) {
  const video = modalBody.querySelector("#video");
  if (!video || modal.classList.contains("hidden")) return;
  const tag = (e.target.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if (e.key === " " || e.key.toLowerCase() === "k") {
    e.preventDefault();
    video.paused ? video.play() : video.pause();
  } else if (e.key === "ArrowRight") {
    video.currentTime = Math.min(video.duration || 1e9, video.currentTime + 10);
  } else if (e.key === "ArrowLeft") {
    video.currentTime = Math.max(0, video.currentTime - 10);
  } else if (e.key.toLowerCase() === "f") {
    toggleFull(video);
  } else if (e.key.toLowerCase() === "m") {
    video.muted = !video.muted;
  }
}

/* ---------- istoric progres ---------- */
let lastHistorySave = 0;
function trackProgress(video, t, season, episode) {
  video.addEventListener("timeupdate", () => {
    const now = Date.now();
    if (now - lastHistorySave < 10000 || video.currentTime < 5) return;
    lastHistorySave = now;
    api("/api/history", {
      method: "POST",
      body: JSON.stringify({
        title_id: t.id,
        season: season ?? null,
        episode: episode ?? null,
        position_seconds: video.currentTime,
        duration_seconds: video.duration || null,
      }),
    }).catch(() => {});
  });
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
