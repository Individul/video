/* Cinema — cărți audio: catalog pe genuri (din trackere, coperți de pe LitRes), pagina cărții,
   biblioteca (descărcări în qBittorrent) și playerul de jos, care ține minte unde ai rămas. */
"use strict";

const BK_SEARCH_ICON = "M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z";
const BK_ICONS = {
  back30: "M12.5 3a9 9 0 0 0-8.9 7.6L1.5 8.5 0 10l4 4 4-4-1.5-1.5-1.8 1.8A7 7 0 1 1 12.5 19v2a9 9 0 0 0 0-18z",
  fwd30: "M11.5 3a9 9 0 0 1 8.9 7.6l2.1-2.1L24 10l-4 4-4-4 1.5-1.5 1.8 1.8A7 7 0 1 0 11.5 19v2a9 9 0 0 1 0-18z",
  list: "M3 6h2v2H3zm4 0h14v2H7zm-4 5h2v2H3zm4 0h14v2H7zm-4 5h2v2H3zm4 0h14v2H7z",
  book: "M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h3v-8H5v-1a7 7 0 0 1 14 0v1h-3v8h3a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9z",
};

const bookHash = (b) => `#/book/${encodeURIComponent(b.author || "-")}/${encodeURIComponent(b.title)}`;
const bookId = (author, title) => `${(author || "").toLowerCase()}|${(title || "").toLowerCase()}`;
const fmtClock = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(sec).padStart(2, "0")}`;
};
const bkDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("ro-RO", { day: "numeric", month: "short", ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
};

/* copertă desenată pentru cărțile fără imagine nicăieri: culoarea vine din titlu (mereu aceeași) */
function bkGenCover(b) {
  let h = 0;
  for (const ch of `${b.title}|${b.author || ""}`) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `<div class="bk-gen" style="--h:${h % 360}">
    <span class="bk-gen-author">${esc(b.author || "")}</span>
    <b class="bk-gen-title${b.title.length > 42 ? " long" : ""}">${esc(b.title)}</b>
    <span class="bk-gen-mark">${svg(BK_ICONS.book, 14)}</span>
  </div>`;
}

/* ---------- coperți: cerute leneș, câte 4 deodată, doar pentru cardurile vizibile ---------- */
const bkMeta = new Map(); // bookId -> meta | null
const bkQueue = [];
let bkActive = 0;
function bkPump() {
  while (bkActive < 4 && bkQueue.length) {
    const { b, done } = bkQueue.shift();
    const id = bookId(b.author, b.title);
    if (bkMeta.has(id)) {
      done(bkMeta.get(id));
      continue;
    }
    bkActive++;
    const qs = new URLSearchParams({ title: b.title });
    if (b.author) qs.set("author", b.author);
    if (b.author_alt) qs.set("alt_author", b.author_alt);
    if (b.title_alt) qs.set("alt_title", b.title_alt);
    api(`/api/books/meta?${qs}`)
      .then((r) => (bkMeta.set(id, r.meta), r.meta))
      .catch(() => null)
      .then((m) => done(m))
      .finally(() => {
        bkActive--;
        bkPump();
      });
  }
}
const bkObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        bkObserver.unobserve(e.target);
        e.target._bkLoad && e.target._bkLoad();
      });
    }, { rootMargin: "300px" })
  : null;
function bkCover(el, b, onMeta) {
  el._bkLoad = () => {
    bkQueue.push({
      b,
      done: (m) => {
        if (m && m.cover && el.isConnected) {
          el.innerHTML = `<img alt="" decoding="async" src="${escUrl(m.cover)}">`;
        }
        onMeta && onMeta(m);
      },
    });
    bkPump();
  };
  if (bkObserver) bkObserver.observe(el);
  else el._bkLoad();
}

function bookCard(b, opts = {}) {
  const div = document.createElement("div");
  div.className = "card book-card";
  const cover = b.cover || (bkMeta.get(bookId(b.author, b.title)) || {}).cover;
  const progress = opts.progress != null ? `<div class="card-progress"><i style="width:${Math.round(opts.progress * 100)}%"></i></div>` : "";
  div.innerHTML = `
    <div class="card-poster"><div class="bk-img">${cover
      ? `<img alt="" decoding="async" src="${escUrl(cover)}">`
      : bkGenCover(b)}</div>
      ${opts.tag ? `<div class="card-tag">${esc(opts.tag)}</div>` : ""}${progress}
    </div>
    <div class="card-name">${esc(b.title)}</div>
    <div class="card-sub${opts.accent ? " accent" : ""}">${esc(opts.sub || b.author || "")}</div>`;
  if (!cover) bkCover(div.querySelector(".bk-img"), b);
  makeActivatable(div, opts.onOpen || (() => go(bookHash(b))), b.title);
  return div;
}

function bookRow(title, list, opts = {}) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<div class="row-title"><div>${esc(title)}</div></div>`;
  if (opts.more) {
    const m = document.createElement("button");
    m.className = "row-more";
    m.textContent = "Toate →";
    m.addEventListener("click", () => go(opts.more));
    row.querySelector(".row-title").appendChild(m);
  }
  const scroll = document.createElement("div");
  scroll.className = "row-scroll";
  if (list) list.forEach((b) => scroll.appendChild(bookCard(b)));
  else scroll.innerHTML = Array.from({ length: 8 }, () => `<div class="card book-card"><div class="skel skel-poster"></div><div class="skel skel-line"></div></div>`).join("");
  row.appendChild(scroll);
  row.fill = (books) => {
    scroll.innerHTML = "";
    books.forEach((b) => scroll.appendChild(bookCard(b)));
  };
  return row;
}

function bkSearchForm(q) {
  const form = document.createElement("form");
  form.className = "ts-form";
  form.innerHTML = `${svg(BK_SEARCH_ICON, 20)}
    <input type="search" placeholder="Autor, titlu, cititor… (ex. Булгаков, Кинг, Гарри Поттер)" autocomplete="off" value="${esc(q || "")}">
    <button class="btn" type="submit">Caută</button>`;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = form.querySelector("input").value.trim();
    go(v ? `#/audiobooks/search/${encodeURIComponent(v)}` : "#/audiobooks");
  });
  return form;
}

/* ================= pagina „Cărți audio” ================= */
async function loadAudiobooks(r) {
  if (r.q) return loadBookGrid({ q: r.q });
  if (r.genre) return loadBookGrid({ genre: r.genre });
  if (r.tag) return loadBookGrid({ tag: r.tag });
  const seq = viewSeq;
  const wrap = document.createElement("div");
  wrap.className = "grid-wrap bk-page";
  wrap.innerHTML = `<div class="view-title">Cărți audio</div>`;
  wrap.appendChild(bkSearchForm(""));
  content.innerHTML = "";
  content.appendChild(wrap);

  // „Continuă să asculți” din bibliotecă (dacă ai început ceva)
  api("/api/books/library").then((lib) => {
    if (seq !== viewSeq) return;
    const started = lib.items.filter((x) => x.listened_at && (x.download || {}).progress >= 1);
    if (!started.length) return;
    const row = bookRow("Continuă să asculți", []);
    const scroll = row.querySelector(".row-scroll");
    started.forEach((x) =>
      scroll.appendChild(bookCard(x, { progress: bkListened(x), sub: bkLeftLabel(x), accent: true, onOpen: () => bkPlay(x) }))
    );
    wrap.insertBefore(row, wrap.querySelector(".row"));
  }).catch(() => {});

  const rows = [["Noutăți", null, "#/audiobooks/search/"]];
  let genres = [];
  try {
    genres = await api("/api/books/genres");
  } catch (_) {}
  if (seq !== viewSeq) return;
  genres.forEach((g) => rows.push([g.name, g.slug]));
  // rândurile se încarcă pe rând (câte 3), ca să nu bombardăm trackerul
  const pending = rows.map(([name, slug]) => {
    const row = bookRow(name, null, slug ? { more: `#/audiobooks/genre/${slug}` } : {});
    wrap.appendChild(row);
    return { row, slug };
  });
  const next = async () => {
    const job = pending.shift();
    if (!job || seq !== viewSeq) return;
    try {
      const res = await api(`/api/books/browse${job.slug ? `?genre=${job.slug}` : ""}`);
      if (seq !== viewSeq) return;
      if (res.books.length) job.row.fill(res.books.slice(0, 30));
      else job.row.remove();
      if (job.slug === "popular") bkExplore(wrap, res.books);
    } catch (_) {
      job.row.remove();
    }
    return next();
  };
  next();
  next();
  next();
}

const tagHash = (t) => `#/audiobooks/tag/${encodeURIComponent(t)}`;

/* numără subgenurile și tagurile cărților (de pe LitRes) -> [[eticheta, câte]] */
function bkFacets(list, field) {
  const counts = new Map();
  list.forEach((b) => (b[field] || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  return [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
}

/* „Explorează”: subgenurile și etichetele cele mai dese printre cărțile populare -> pagina lor */
function bkExplore(wrap, books) {
  const top = [...bkFacets(books, "genres").slice(0, 10), ...bkFacets(books, "tags").filter(([, n]) => n >= 2).slice(0, 10)];
  if (top.length < 4) return;
  const box = document.createElement("div");
  box.className = "q-filter bk-explore";
  box.innerHTML = `<span class="bk-flabel">Explorează</span>` + top.map(([t]) => `<a href="${tagHash(t)}">${esc(t)}</a>`).join("");
  wrap.querySelector(".ts-form").after(box);
}

async function loadBookGrid({ q, genre, tag }) {
  const seq = viewSeq;
  const gname = genre ? ((await api("/api/books/genres").catch(() => [])).find((g) => g.slug === genre) || {}).name : null;
  if (seq !== viewSeq) return;
  const wrap = document.createElement("div");
  wrap.className = "grid-wrap bk-page";
  const label = q ? `„${q}”` : tag ? `#${tag}` : gname || "Gen";
  wrap.innerHTML = `<div class="view-title"><a href="#/audiobooks" class="bk-crumb">Cărți audio</a> › ${esc(label)}</div>`;
  wrap.appendChild(bkSearchForm(q));
  const box = document.createElement("div");
  box.innerHTML = `<div class="status">${q ? "Caut pe trackere…" : "Se încarcă…"}</div>`;
  wrap.appendChild(box);
  content.innerHTML = "";
  content.appendChild(wrap);
  if (q || tag) document.title = `${q || tag} — Cărți audio — Cinema`;
  let res;
  try {
    const qs = q ? `q=${encodeURIComponent(q)}` : tag ? `tag=${encodeURIComponent(tag)}` : `genre=${encodeURIComponent(genre)}`;
    res = await api(`/api/books/browse?${qs}`);
  } catch (err) {
    if (seq === viewSeq) box.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
    return;
  }
  if (seq !== viewSeq) return;
  if (!res.books.length) {
    box.innerHTML = `<div class="status">${q ? `Nimic găsit pentru „${esc(q)}”.`
      : tag ? "Nicio carte cu eticheta asta încă — etichetele se adună treptat de pe LitRes." : "Nimic aici acum."}</div>`;
    return;
  }
  const books = res.books;
  const known = books.filter((b) => b.genres.length || b.tags.length).length;
  const sub = bkFacets(books, "genres").filter(([t]) => t.toLowerCase() !== (tag || "").toLowerCase()).slice(0, 14);
  const tags = bkFacets(books, "tags").filter(([t, n]) => n >= 2 && t.toLowerCase() !== (tag || "").toLowerCase()).slice(0, 24);
  let pickSub = null, pickTag = null;
  const filters = document.createElement("div");
  filters.className = "bk-filters";
  const chips = (list, kind) => list.map(([t, n]) => `<button data-k="${kind}" data-t="${esc(t)}">${kind === "tag" ? "#" : ""}${esc(t)} <small>${n}</small></button>`).join("");
  filters.innerHTML =
    (sub.length ? `<div class="q-filter bk-sub"><span class="bk-flabel">Subgen</span>${chips(sub, "sub")}</div>` : "") +
    (tags.length ? `<div class="q-filter bk-tags"><span class="bk-flabel">Etichete</span>${chips(tags, "tag")}</div>` : "") +
    (known < books.length ? `<div class="ts-note">Etichete știute pentru ${known} din ${books.length} cărți — restul se adună acum de pe LitRes (reîncarcă peste câteva minute).</div>` : "");
  const grid = document.createElement("div");
  grid.className = "grid bk-grid";
  const draw = () => {
    grid.innerHTML = "";
    const shown = books.filter((b) => (!pickSub || b.genres.includes(pickSub)) && (!pickTag || b.tags.includes(pickTag)));
    if (!shown.length) grid.innerHTML = `<div class="status">Nicio carte cu ambele filtre.</div>`;
    shown.forEach((b) => grid.appendChild(bookCard(b, { sub: [b.author, b.versions.length > 1 ? `${b.versions.length} versiuni` : ""].filter(Boolean).join(" · ") })));
    filters.querySelectorAll("button").forEach((x) =>
      x.classList.toggle("on", (x.dataset.k === "sub" ? pickSub : pickTag) === x.dataset.t));
  };
  filters.addEventListener("click", (e) => {
    const x = e.target.closest("button");
    if (!x) return;
    if (x.dataset.k === "sub") pickSub = pickSub === x.dataset.t ? null : x.dataset.t;
    else pickTag = pickTag === x.dataset.t ? null : x.dataset.t;
    draw();
  });
  box.innerHTML = "";
  if (sub.length || tags.length || known < books.length) box.appendChild(filters);
  box.appendChild(grid);
  draw();
}

/* ================= pagina cărții ================= */
async function loadBook(r) {
  const seq = viewSeq;
  content.innerHTML = `<div class="grid-wrap bk-page"><div class="status">Caut cartea pe trackere…</div></div>`;
  let data, lib;
  try {
    [data, lib] = await Promise.all([
      api(`/api/books/book?title=${encodeURIComponent(r.title)}${r.author ? `&author=${encodeURIComponent(r.author)}` : ""}`),
      api("/api/books/library").catch(() => ({ items: [] })),
    ]);
  } catch (err) {
    if (seq === viewSeq) content.innerHTML = `<div class="grid-wrap"><div class="status error">Eroare: ${esc(err.message)}</div></div>`;
    return;
  }
  if (seq !== viewSeq) return;
  const b = data.book || { author: r.author, title: r.title, versions: [], narrators: [] };
  const m = data.meta || {};
  if (m.cover) bkMeta.set(bookId(b.author, b.title), m);
  document.title = `${b.title} — Cinema`;
  const owned = lib.items.find((x) => bookId(x.author, x.title) === bookId(b.author, b.title));

  const wrap = document.createElement("div");
  wrap.className = "grid-wrap bk-page";
  const readers = b.narrators.length ? b.narrators : m.readers || [];
  wrap.innerHTML = `
    <div class="bk-hero">
      <div class="bk-cover">${m.cover ? `<img alt="" src="${escUrl(m.cover)}">` : bkGenCover(b)}</div>
      <div class="bk-info">
        <a href="#/audiobooks" class="bk-crumb">Cărți audio</a>
        ${b.series ? `<div class="bk-series">${esc(b.series)}</div>` : ""}
        <h1>${esc(b.title)}</h1>
        ${b.author ? `<div class="bk-author">${esc(b.author)}</div>` : ""}
        <div class="bk-facts">
          ${m.rating ? `<span class="bk-rating">★ ${esc(m.rating)}</span>` : ""}
          ${m.written || b.year ? `<span>${esc(m.written || b.year)}</span>` : ""}
          ${b.lang ? `<span>${esc(b.lang)}</span>` : ""}
          ${readers.length ? `<span>🎙 ${esc(readers.slice(0, 3).join(", "))}${readers.length > 3 ? " …" : ""}</span>` : ""}
        </div>
        ${(m.genres && m.genres.length) || (m.tags && m.tags.length) ? `<div class="bk-genres">${(m.genres || []).map((g) => `<a href="${tagHash(g)}">${esc(g)}</a>`).join("")}${(m.tags || []).map((g) => `<a class="tag" href="${tagHash(g)}">#${esc(g)}</a>`).join("")}</div>` : ""}
        <div id="bk-owned"></div>
        ${m.description ? `<div class="bk-desc">${m.description.split("\n").map((p) => `<p>${esc(p)}</p>`).join("")}</div>` : ""}
      </div>
    </div>
    <div class="cal-day-head">Versiuni pe trackere<span>${b.versions.length}</span></div>
    <div class="torrent-list" id="bk-versions"></div>`;
  content.innerHTML = "";
  content.appendChild(wrap);
  const desc = wrap.querySelector(".bk-desc");
  if (desc && desc.scrollHeight > 190) {
    desc.classList.add("clamp");
    const more = document.createElement("button");
    more.className = "row-more bk-more";
    more.textContent = "Mai mult";
    more.addEventListener("click", () => {
      desc.classList.toggle("clamp");
      more.textContent = desc.classList.contains("clamp") ? "Mai mult" : "Mai puțin";
    });
    desc.after(more);
  }

  const ownedBox = wrap.querySelector("#bk-owned");
  const drawOwned = (x) => {
    if (!x) {
      ownedBox.innerHTML = "";
      return;
    }
    const d = x.download || {};
    const done = d.progress >= 1;
    ownedBox.innerHTML = `<div class="bk-owned">
      ${done
        ? `<button class="btn">${svg(I.play, 18)} ${x.listened_at ? "Continuă" : "Ascultă"}</button><span>${esc(x.listened_at ? bkLeftLabel(x) : "În biblioteca ta")}</span>`
        : `<span>Se descarcă în bibliotecă: <b>${Math.floor((d.progress || 0) * 100)}%</b>${d.dl_bps ? ` · ↓ ${esc(bkSpeed(d.dl_bps))}` : ""}${bkEta(d.eta) ? ` · ${esc(bkEta(d.eta))}` : ""}</span>
           <div class="lib-bar"><i style="width:${((d.progress || 0) * 100).toFixed(1)}%"></i></div>`}
    </div>`;
    const btn = ownedBox.querySelector("button");
    if (btn) btn.addEventListener("click", () => bkPlay({ ...x, cover: x.cover || m.cover }));
    if (!done) setTimeout(async () => {
      if (seq !== viewSeq) return;
      const l = await api("/api/books/library").catch(() => null);
      if (l && seq === viewSeq) drawOwned(l.items.find((y) => y.hash === x.hash));
    }, 3000);
  };
  drawOwned(owned);

  const list = wrap.querySelector("#bk-versions");
  if (!b.versions.length) list.innerHTML = `<div class="status">Nicio versiune găsită acum pe trackere.</div>`;
  b.versions.forEach((v) => {
    const row = document.createElement("div");
    row.className = "torrent-row";
    const meta = [v.year, v.bitrate, v.format, v.size,
      v.seeds != null ? `<span class="${v.seeds > 0 ? "t-seeds" : ""}">▲ ${Number(v.seeds)}</span>` : null,
      v.indexer, v.published ? bkDate(v.published) : null].filter(Boolean);
    row.innerHTML = `
      <div class="t-name"><b>${esc(v.narrator || "Cititor necunoscut")}</b>
        <div class="t-meta">${meta.map((x) => (String(x).startsWith("<span") ? x : esc(x))).join(" · ")}</div></div>
      <button class="btn small lib-add">${svg(I.download, 15)} Adaugă</button>`;
    const btn = row.querySelector("button");
    if (owned) btn.disabled = true;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const res = await api("/api/books/add", {
          method: "POST",
          body: JSON.stringify({
            source: { magnet: v.magnet || null, torrent_url: v.torrent_url || null },
            book: { author: b.author || null, title: b.title, narrator: v.narrator || null, cover: m.cover || null },
          }),
        });
        toast("Adăugată în bibliotecă — se descarcă");
        list.querySelectorAll(".lib-add").forEach((x) => (x.disabled = true));
        btn.classList.add("done");
        btn.innerHTML = `${svg(I.check, 15)} În bibliotecă`;
        drawOwned({ hash: res.hash, author: b.author, title: b.title, cover: m.cover, download: { progress: 0 } });
      } catch (err) {
        btn.disabled = false;
        toast(err.message, false);
      }
    });
    list.appendChild(row);
  });
}

/* ================= biblioteca ================= */
const BK_STATES = {
  downloading: "Se descarcă", forcedDL: "Se descarcă", metaDL: "Caută metadatele…", forcedMetaDL: "Caută metadatele…",
  stalledDL: "Așteaptă surse", queuedDL: "În coadă", checkingDL: "Verificare", checkingUP: "Verificare",
  checkingResumeData: "Verificare", moving: "Se mută", error: "Eroare", missingFiles: "Fișiere lipsă",
};
const bkEta = (s) => (!s || s <= 0 || s >= 8640000 ? "" : s < 3600 ? `~${Math.max(1, Math.round(s / 60))} min` : `~${Math.round(s / 360) / 10} h`);
const bkSpeed = (bps) => (bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} Mbit/s` : `${Math.round(bps / 1e3)} kbit/s`);
const bkListened = (x) => (x.tracks_total ? Math.min(1, (x.track_no + (x.duration ? x.position / x.duration : 0)) / x.tracks_total) : 0);
const bkLeftLabel = (x) => (x.tracks_total ? `Pista ${x.track_no + 1} din ${x.tracks_total} · ${fmtClock(x.position)}` : "Început");

async function loadLibrary() {
  const seq = viewSeq;
  content.innerHTML = `<div class="grid-wrap bk-page"><div class="view-title">Biblioteca</div><div class="status">Se încarcă...</div></div>`;
  const wrap = document.createElement("div");
  wrap.className = "grid-wrap bk-page";
  let timer = null;
  const refresh = async () => {
    let data;
    try {
      data = await api("/api/books/library");
    } catch (err) {
      if (seq === viewSeq) content.innerHTML = `<div class="grid-wrap"><div class="status error">${esc(err.message)}</div></div>`;
      return;
    }
    if (seq !== viewSeq) return;
    wrap.innerHTML = `
      <div class="view-title">Biblioteca</div>
      <div class="lib-summary"><span>Ocupat: <b>${esc(data.used)}</b>${data.free ? ` · liber pe disc: <b>${esc(data.free)}</b>` : ""}</span></div>`;
    if (!data.items.length) {
      wrap.innerHTML += `<div class="status">Biblioteca e goală. Alege o carte din <a href="#/audiobooks">Cărți audio</a> și apasă „Adaugă”.</div>`;
    }
    const list = document.createElement("div");
    list.className = "torrent-list";
    let active = false;
    data.items.forEach((x) => {
      const d = x.download || {};
      const done = d.progress >= 1;
      if (!done && x.download) active = true;
      const state = !x.download ? "Lipsește din qBittorrent" : done ? (x.listened_at ? bkLeftLabel(x) : "Gata de ascultat") : BK_STATES[d.state] || "Oprit";
      const bits = [x.author, d.size, state];
      if (!done && d.dl_bps) bits.push("↓ " + bkSpeed(d.dl_bps));
      if (!done && bkEta(d.eta)) bits.push(bkEta(d.eta));
      const row = document.createElement("div");
      row.className = "torrent-row bk-lib-row";
      row.innerHTML = `
        <div class="bk-thumb">${x.cover ? `<img alt="" src="${escUrl(x.cover)}">` : bkGenCover(x)}</div>
        <div class="t-name"><b>${esc(x.title)}</b>
          <div class="t-meta">${bits.filter(Boolean).map(esc).join(" · ")}</div>
          ${done ? (x.listened_at ? `<div class="lib-bar listened"><i style="width:${(bkListened(x) * 100).toFixed(1)}%"></i></div>` : "")
                 : `<div class="lib-bar"><i style="width:${((d.progress || 0) * 100).toFixed(1)}%"></i></div>`}
        </div>
        ${done ? `<button class="btn small bk-play">${svg(I.play, 15)} ${x.listened_at ? "Continuă" : "Ascultă"}</button>`
               : `<span class="lib-pct">${Math.floor((d.progress || 0) * 100)}%</span>`}
        <button class="btn small ghost bk-del" title="Șterge din bibliotecă (și fișierele)">${svg(I.trash, 15)}</button>`;
      const play = row.querySelector(".bk-play");
      if (play) play.addEventListener("click", () => bkPlay(x));
      row.querySelector(".bk-del").addEventListener("click", async () => {
        if (!confirm(`Ștergi „${x.title}” din bibliotecă, cu tot cu fișiere?`)) return;
        try {
          if (BP.book && BP.book.hash === x.hash) bkClose();
          await api(`/api/books/${encodeURIComponent(x.hash)}`, { method: "DELETE" });
          toast("Ștearsă din bibliotecă");
          refresh();
        } catch (err) {
          toast(err.message, false);
        }
      });
      list.appendChild(row);
    });
    if (data.items.length) wrap.appendChild(list);
    if (!wrap.isConnected) {
      content.innerHTML = "";
      content.appendChild(wrap);
    }
    clearTimeout(timer);
    if (active) timer = setTimeout(() => seq === viewSeq && refresh(), 3000);
  };
  refresh();
}

/* ================= playerul de jos ================= */
const BP = { book: null, tracks: [], i: 0, el: null, audio: null, lastSave: 0, pendingSeek: null };
const BK_SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];

function bkBar() {
  if (BP.el) return BP.el;
  const el = document.createElement("div");
  el.id = "bk-player";
  el.innerHTML = `
    <div class="bp-cover"></div>
    <div class="bp-main">
      <div class="bp-title"><b></b><span></span></div>
      <div class="bp-seek"><span class="bp-cur">0:00</span><input type="range" min="0" max="1000" value="0" aria-label="Poziția în pistă"><span class="bp-dur">0:00</span></div>
    </div>
    <div class="bp-ctrl">
      <button class="bp-b" data-a="back" title="Înapoi 30 s">${svg(BK_ICONS.back30, 22)}<small>30</small></button>
      <button class="bp-b bp-play" data-a="play" title="Redă / pauză">${svg(I.play, 26)}</button>
      <button class="bp-b" data-a="fwd" title="Înainte 30 s">${svg(BK_ICONS.fwd30, 22)}<small>30</small></button>
      <button class="bp-b bp-speed" data-a="speed" title="Viteza">1×</button>
      <div class="bp-vol">
        <button class="bp-b" data-a="mute" title="Sunet / mut">${svg(I.vol, 20)}</button>
        <input type="range" min="0" max="100" value="100" aria-label="Volum" title="Volum (rotița mouse-ului)">
      </div>
      <button class="bp-b" data-a="list" title="Piste">${svg(BK_ICONS.list, 20)}</button>
      <button class="bp-b" data-a="close" title="Închide">${svg(I.close, 18)}</button>
    </div>
    <div class="bp-tracks" hidden></div>`;
  document.body.appendChild(el);
  const audio = new Audio();
  audio.preload = "auto";
  // defaultPlaybackRate: viteza rămâne și la pista următoare (src nou o resetează la „default”)
  try {
    audio.defaultPlaybackRate = audio.playbackRate = +localStorage.getItem("bk-speed") || 1;
  } catch (_) {}
  BP.el = el;
  BP.audio = audio;
  const range = el.querySelector(".bp-seek input");
  let dragging = false;
  range.addEventListener("input", () => {
    dragging = true;
    el.querySelector(".bp-cur").textContent = fmtClock((range.value / 1000) * (audio.duration || 0));
  });
  range.addEventListener("change", () => {
    dragging = false;
    if (audio.duration) audio.currentTime = (range.value / 1000) * audio.duration;
    bkSave(true);
  });
  audio.addEventListener("timeupdate", () => {
    if (!dragging && audio.duration) range.value = Math.round((audio.currentTime / audio.duration) * 1000);
    if (!dragging) el.querySelector(".bp-cur").textContent = fmtClock(audio.currentTime);
    if (Date.now() - BP.lastSave > 15000) bkSave();
  });
  audio.addEventListener("loadedmetadata", () => {
    el.querySelector(".bp-dur").textContent = fmtClock(audio.duration);
    if (BP.pendingSeek != null) {
      audio.currentTime = Math.min(BP.pendingSeek, Math.max(0, audio.duration - 3));
      BP.pendingSeek = null;
    }
  });
  const syncPlay = () => {
    el.querySelector(".bp-play").innerHTML = svg(audio.paused ? I.play : I.pause, 26);
    el.classList.toggle("playing", !audio.paused);
  };
  audio.addEventListener("play", syncPlay);
  audio.addEventListener("pause", () => {
    syncPlay();
    bkSave(true);
  });
  audio.addEventListener("ended", () => {
    if (BP.i + 1 < BP.tracks.length) bkLoad(BP.i + 1, 0, true);
    else {
      bkSave(true);
      toast("Ai terminat cartea 🎉");
    }
  });
  audio.addEventListener("error", () => toast("Nu pot reda pista (fișier lipsă sau format nesuportat)", false));
  el.querySelector(".bp-ctrl").addEventListener("click", (e) => {
    const a = e.target.closest("button")?.dataset.a;
    if (a === "play") audio.paused ? audio.play().catch(() => {}) : audio.pause();
    if (a === "back") audio.currentTime = Math.max(0, audio.currentTime - 30);
    if (a === "fwd") audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 30);
    if (a === "speed") {
      const i = BK_SPEEDS.indexOf(audio.playbackRate);
      audio.defaultPlaybackRate = audio.playbackRate = BK_SPEEDS[(i + 1) % BK_SPEEDS.length];
      try {
        localStorage.setItem("bk-speed", audio.playbackRate);
      } catch (_) {}
      bkSyncSpeed();
    }
    if (a === "list") bkToggleTracks();
    if (a === "mute") {
      if (audio.muted || audio.volume === 0) {
        if (audio.volume === 0) audio.volume = 0.5;
        audio.muted = false;
      } else audio.muted = true;
    }
    if (a === "close") bkClose();
  });
  // un film pornit oprește cartea
  document.addEventListener("play", (e) => e.target !== audio && e.target.tagName === "VIDEO" && audio.pause(), true);
  window.addEventListener("pagehide", () => bkSave(true));
  if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => audio.play());
    ms.setActionHandler("pause", () => audio.pause());
    ms.setActionHandler("seekbackward", () => (audio.currentTime = Math.max(0, audio.currentTime - 30)));
    ms.setActionHandler("seekforward", () => (audio.currentTime += 30));
    ms.setActionHandler("previoustrack", () => BP.i > 0 && bkLoad(BP.i - 1, 0, true));
    ms.setActionHandler("nexttrack", () => BP.i + 1 < BP.tracks.length && bkLoad(BP.i + 1, 0, true));
  }
  // volumul: glisor + mut, ținute minte; rotița mouse-ului pe glisor = ±5
  const vol = el.querySelector(".bp-vol input");
  try {
    const v = localStorage.getItem("bk-vol");
    if (v != null) audio.volume = Math.min(1, Math.max(0, +v));
    audio.muted = localStorage.getItem("bk-muted") === "1";
  } catch (_) {}
  const syncVol = () => {
    vol.value = Math.round((audio.muted ? 0 : audio.volume) * 100);
    vol.style.setProperty("--v", `${vol.value}%`);
    el.querySelector('[data-a="mute"]').innerHTML = svg(audio.muted || audio.volume === 0 ? I.mute : I.vol, 20);
    try {
      localStorage.setItem("bk-vol", audio.volume);
      localStorage.setItem("bk-muted", audio.muted ? "1" : "0");
    } catch (_) {}
  };
  const setVol = (v) => {
    audio.volume = Math.min(1, Math.max(0, v));
    audio.muted = audio.volume === 0;
  };
  vol.addEventListener("input", () => setVol(vol.value / 100));
  vol.addEventListener("wheel", (e) => {
    e.preventDefault();
    setVol((audio.muted ? 0 : audio.volume) + (e.deltaY < 0 ? 0.05 : -0.05));
  }, { passive: false });
  audio.addEventListener("volumechange", syncVol);
  syncVol();
  bkSyncSpeed();
  return el;
}

function bkSyncSpeed() {
  BP.el.querySelector(".bp-speed").textContent = `${BP.audio.playbackRate}×`;
}

// `at`: poziția la schimbarea pistei (audio.currentTime e încă cea a pistei vechi până se încarcă noua)
function bkSave(force, at) {
  if (!BP.book || !BP.tracks.length) return;
  BP.lastSave = Date.now();
  const t = BP.tracks[BP.i];
  const fresh = at == null && BP.pendingSeek == null && BP.audio.readyState > 0;
  const body = JSON.stringify({
    track: t.index, track_no: BP.i, tracks_total: BP.tracks.length,
    position: at != null ? at : fresh ? BP.audio.currentTime || 0 : BP.pendingSeek || 0,
    duration: fresh && Number.isFinite(BP.audio.duration) ? BP.audio.duration : null,
  });
  fetch(`/api/books/${encodeURIComponent(BP.book.hash)}/progress`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body, keepalive: !!force,
  }).catch(() => {});
}

function bkLoad(i, pos, autoplay) {
  BP.i = i;
  BP.pendingSeek = pos > 0 ? pos : null;
  const t = BP.tracks[i];
  BP.audio.src = `/api/books/${encodeURIComponent(BP.book.hash)}/file/${t.index}`;
  const sub = BP.tracks.length > 1 ? `Pista ${i + 1} din ${BP.tracks.length} · ${t.title}` : BP.book.author || "";
  BP.el.querySelector(".bp-title span").textContent = sub;
  BP.el.querySelectorAll(".bp-tracks button").forEach((b, k) => b.classList.toggle("on", k === i));
  if (autoplay) BP.audio.play().catch(() => {});
  if ("mediaSession" in navigator && window.MediaMetadata) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: BP.book.title, artist: BP.book.author || "", album: sub,
      artwork: BP.book.cover ? [{ src: BP.book.cover, sizes: "415x415", type: "image/jpeg" }] : [],
    });
  }
  bkSave(false, pos > 0 ? pos : 0);
}

function bkToggleTracks() {
  const box = BP.el.querySelector(".bp-tracks");
  box.hidden = !box.hidden;
  if (!box.hidden) box.querySelector(".on")?.scrollIntoView({ block: "center" });
}

async function bkPlay(x) {
  const el = bkBar();
  let tracks;
  try {
    tracks = await api(`/api/books/${encodeURIComponent(x.hash)}/tracks`);
  } catch (err) {
    return toast(err.message, false);
  }
  if (!tracks.length) return toast("Nu găsesc fișiere audio în torrent", false);
  if (BP.book && BP.book.hash !== x.hash) bkSave(true);
  BP.book = x;
  BP.tracks = tracks;
  el.querySelector(".bp-cover").innerHTML = x.cover ? `<img alt="" src="${escUrl(x.cover)}">` : svg(BK_ICONS.book, 26);
  el.querySelector(".bp-title b").textContent = x.title;
  const box = el.querySelector(".bp-tracks");
  box.hidden = true;
  box.innerHTML = "";
  tracks.forEach((t, k) => {
    const b = document.createElement("button");
    b.innerHTML = `<span>${k + 1}</span>${esc(t.title)}`;
    b.addEventListener("click", () => {
      bkLoad(k, 0, true);
      box.hidden = true;
    });
    box.appendChild(b);
  });
  document.body.classList.add("bk-open");
  let i = tracks.findIndex((t) => t.index === x.track);
  if (i < 0) i = 0;
  // pista terminată (mai puțin de 5 s rămase) -> următoarea
  if (x.duration && x.duration - x.position < 5 && i + 1 < tracks.length) bkLoad(i + 1, 0, true);
  else bkLoad(i, Math.max(0, (x.position || 0) - 3), true); // reia cu 3 s înainte, ca să prinzi firul
}

function bkClose() {
  if (!BP.el) return;
  BP.audio.pause();
  bkSave(true);
  BP.audio.removeAttribute("src");
  BP.audio.load();
  BP.book = null;
  document.body.classList.remove("bk-open");
}
