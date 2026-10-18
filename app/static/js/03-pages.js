/* Cinema — Acasă, Filme/Seriale (filtre), Watchlist, Continuă.
   Scripturi clasice încărcate în ordine (index.html): împart același spațiu global. */
"use strict";

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
