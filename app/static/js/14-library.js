/* Cinema — biblioteca: muzică și cărți audio.
   Catalogul vine din categoriile trackerelor (Jackett); ce adaugi descarcă qBittorrent pe server,
   iar ascultarea e în Navidrome (/music/) și Audiobookshelf (/audiobookshelf/). */
"use strict";

const LIB_KINDS = {
  music: {
    title: "Muzică",
    hint: "Ultimele albume și discografii apărute pe trackere. „Adaugă” le descarcă în biblioteca ta de muzică (Navidrome), unde rămân.",
    placeholder: "Artist, album, gen… (ex. Queen, Hans Zimmer, jazz FLAC)",
    player: "/music/",
    playerName: "Navidrome",
  },
  audiobooks: {
    title: "Cărți audio",
    hint: "Ultimele cărți audio apărute pe trackere. „Adaugă” le descarcă în biblioteca ta (Audiobookshelf), unde rămân.",
    placeholder: "Autor, titlu, cititor… (ex. Булгаков, Кинг, Harry Potter)",
    player: "/audiobookshelf/",
    playerName: "Audiobookshelf",
  },
};
const LIB_FORMATS = [
  ["all", "Toate", null],
  ["flac", "Lossless", /\b(flac|ape|alac|wavpack|wv|dsd|lossless|hi-?res|24[- ]?bit)\b/i],
  ["mp3", "MP3", /\b(mp3|aac|m4a|ogg|opus|kbps|кбит)\b/i],
];
let libFormat = "all";
let libSource = "all";

const libDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("ro-RO", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
};

async function loadLibraryCatalog(kind, q) {
  const seq = viewSeq;
  const cfg = LIB_KINDS[kind];
  q = (q || "").trim();
  content.innerHTML = `
    <div class="grid-wrap lib-page">
      <div class="view-title">${cfg.title}
        <a class="btn ghost small lib-open" href="${cfg.player}" target="_blank" rel="noopener">${svg(I.external, 14)} Ascultă în ${cfg.playerName}</a>
      </div>
      <div class="cal-hint">${esc(cfg.hint)}</div>
      <form class="ts-form" id="lib-form">
        ${svg("M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z", 20)}
        <input id="lib-q" type="search" placeholder="${esc(cfg.placeholder)}" autocomplete="off" value="${esc(q)}">
        <button class="btn" type="submit">Caută</button>
      </form>
      <div id="lib-filters"></div>
      <div id="lib-body"><div class="status">${q ? "Caut pe trackere…" : "Se încarcă noutățile…"} (până la ~20 s)</div></div>
    </div>`;
  const input = $("#lib-q");
  $("#lib-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.trim();
    go(v ? `#/${kind}/${encodeURIComponent(v)}` : `#/${kind}`);
  });
  if (q) document.title = `${q} — ${cfg.title} — Cinema`;

  let data, lib;
  try {
    [data, lib] = await Promise.all([
      api(`/api/library/browse/${kind}${q ? `?q=${encodeURIComponent(q)}` : ""}`),
      api("/api/library").catch(() => ({ items: [] })),
    ]);
  } catch (err) {
    if (seq === viewSeq) $("#lib-body").innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
    return;
  }
  if (seq !== viewSeq) return;
  const results = data.results;
  const body = $("#lib-body");
  if (!results.length) {
    body.innerHTML = `<div class="status">${q ? `Nimic găsit pentru „${esc(q)}”.` : "Nicio apariție recentă."}</div>`;
    return;
  }
  const have = new Set((lib.items || []).map((x) => x.name));

  // filtre: format (doar la muzică) și sursă
  const formats = kind === "music" ? LIB_FORMATS.filter(([k, , rx]) => !rx || results.some((r) => rx.test(r.name))) : [];
  if (!formats.some(([k]) => k === libFormat)) libFormat = "all";
  const counts = {};
  results.forEach((r) => (counts[r.indexer || "?"] = (counts[r.indexer || "?"] || 0) + 1));
  const sources = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  if (libSource !== "all" && !counts[libSource]) libSource = "all";
  const filters = $("#lib-filters");
  filters.innerHTML =
    (formats.length > 2
      ? `<div class="q-filter lib-fmt">${formats.map(([k, l]) => `<button data-f="${k}" class="${k === libFormat ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`
      : "") +
    (sources.length > 1
      ? `<div class="q-filter lib-src">${[["all", `Toate sursele ${results.length}`], ...sources.map((s) => [s, `${s} ${counts[s]}`])]
          .map(([v, l]) => `<button data-s="${esc(v)}" class="${v === libSource ? "on" : ""}">${esc(l)}</button>`)
          .join("")}</div>`
      : "");

  const list = document.createElement("div");
  list.className = "torrent-list lib-list";
  body.innerHTML = "";
  body.appendChild(list);

  const draw = () => {
    const rx = (LIB_FORMATS.find(([k]) => k === libFormat) || [])[2];
    const shown = results.filter((r) => (!rx || rx.test(r.name)) && (libSource === "all" || (r.indexer || "?") === libSource));
    list.innerHTML = shown.length ? "" : `<div class="status">Nimic cu filtrele astea.</div>`;
    shown.forEach((r) => {
      const row = document.createElement("div");
      row.className = "torrent-row";
      const meta = [
        r.size,
        r.seeds != null ? `<span class="${r.seeds > 0 ? "t-seeds" : ""}">▲ ${Number(r.seeds)}</span>` : null,
        r.indexer ? esc(r.indexer) : null,
        r.published ? esc(libDate(r.published)) : null,
      ].filter(Boolean);
      const added = have.has(r.name);
      row.innerHTML = `
        <div class="t-name">${esc(r.name)}<div class="t-meta">${meta.join(" · ")}</div></div>
        <button class="btn small lib-add${added ? " done" : ""}" ${added ? "disabled" : ""}>${svg(added ? I.check : I.download, 15)} ${added ? "În bibliotecă" : "Adaugă"}</button>`;
      const btn = row.querySelector("button");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await api("/api/library/add", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind, source: { magnet: r.magnet || null, torrent_url: r.torrent_url || null } }),
          });
          have.add(r.name);
          btn.classList.add("done");
          btn.innerHTML = `${svg(I.check, 15)} În bibliotecă`;
          toast("Adăugat — se descarcă (vezi Biblioteca)");
        } catch (err) {
          btn.disabled = false;
          toast(err.message, false);
        }
      });
      list.appendChild(row);
    });
  };
  filters.querySelectorAll(".lib-fmt button").forEach((b) =>
    b.addEventListener("click", () => {
      libFormat = b.dataset.f;
      filters.querySelectorAll(".lib-fmt button").forEach((x) => x.classList.toggle("on", x === b));
      draw();
    })
  );
  filters.querySelectorAll(".lib-src button").forEach((b) =>
    b.addEventListener("click", () => {
      libSource = b.dataset.s;
      filters.querySelectorAll(".lib-src button").forEach((x) => x.classList.toggle("on", x === b));
      draw();
    })
  );
  draw();
}

/* ================= BIBLIOTECA: ce s-a descărcat / se descarcă ================= */
const LIB_STATES = {
  downloading: "Se descarcă",
  forcedDL: "Se descarcă",
  metaDL: "Caută metadatele…",
  forcedMetaDL: "Caută metadatele…",
  stalledDL: "Așteaptă surse",
  queuedDL: "În coadă",
  checkingDL: "Verificare",
  checkingUP: "Verificare",
  checkingResumeData: "Verificare",
  moving: "Se mută",
  error: "Eroare",
  missingFiles: "Fișiere lipsă",
};
const libEta = (s) => (s <= 0 || s >= 8640000 ? "" : s < 3600 ? `~${Math.max(1, Math.round(s / 60))} min` : `~${Math.round(s / 360) / 10} h`);
const libSpeed = (bps) => (bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} Mbit/s` : `${Math.round(bps / 1e3)} kbit/s`);

async function loadLibrary() {
  const seq = viewSeq;
  content.innerHTML = `<div class="grid-wrap lib-page"><div class="view-title">Biblioteca</div><div class="status">Se încarcă...</div></div>`;
  const wrap = document.createElement("div");
  wrap.className = "grid-wrap lib-page";
  let timer = null;

  const refresh = async () => {
    let data;
    try {
      data = await api("/api/library");
    } catch (err) {
      if (seq === viewSeq) content.innerHTML = `<div class="status error">${esc(err.message)}</div>`;
      return;
    }
    if (seq !== viewSeq) return;
    const active = data.items.some((x) => x.progress < 1 && LIB_STATES[x.state]);
    wrap.innerHTML = `
      <div class="view-title">Biblioteca</div>
      <div class="lib-summary">
        <span>Ocupat: <b>${esc(data.used)}</b>${data.free ? ` · liber pe disc: <b>${esc(data.free)}</b>` : ""}</span>
        <a class="btn ghost small" href="${LIB_KINDS.music.player}" target="_blank" rel="noopener">${svg(I.external, 14)} Muzică (Navidrome)</a>
        <a class="btn ghost small" href="${LIB_KINDS.audiobooks.player}" target="_blank" rel="noopener">${svg(I.external, 14)} Cărți audio (Audiobookshelf)</a>
      </div>`;
    if (!data.items.length) {
      wrap.innerHTML += `<div class="status">Biblioteca e goală. Adaugă ceva din <a href="#/music">Muzică</a> sau <a href="#/audiobooks">Cărți audio</a>.</div>`;
    }
    for (const kind of Object.keys(LIB_KINDS)) {
      const items = data.items.filter((x) => x.kind === kind);
      if (!items.length) continue;
      const sec = document.createElement("section");
      sec.innerHTML = `<div class="cal-day-head">${LIB_KINDS[kind].title}<span>${items.length}</span></div>`;
      const list = document.createElement("div");
      list.className = "torrent-list";
      items.forEach((d) => {
        const done = d.progress >= 1;
        const state = done ? "Gata" : LIB_STATES[d.state] || "Oprit";
        const bits = [d.size, state];
        if (!done && d.dl_bps) bits.push("↓ " + libSpeed(d.dl_bps));
        if (!done && libEta(d.eta)) bits.push(libEta(d.eta));
        const row = document.createElement("div");
        row.className = "torrent-row lib-item" + (done ? " done" : "");
        row.innerHTML = `
          <div class="t-name">${esc(d.name)}
            <div class="t-meta">${bits.filter(Boolean).map(esc).join(" · ")}</div>
            ${done ? "" : `<div class="lib-bar"><i style="width:${(d.progress * 100).toFixed(1)}%"></i></div>`}
          </div>
          ${done ? "" : `<span class="lib-pct">${Math.floor(d.progress * 100)}%</span>`}
          <button class="btn small danger" title="Șterge din bibliotecă (și fișierele)">${svg(I.trash, 15)}</button>`;
        row.querySelector("button").addEventListener("click", async () => {
          if (!confirm(`Ștergi „${d.name}” din bibliotecă, cu tot cu fișiere?`)) return;
          try {
            await api(`/api/library/${encodeURIComponent(d.hash)}`, { method: "DELETE" });
            toast("Șters din bibliotecă");
            refresh();
          } catch (err) {
            toast(err.message, false);
          }
        });
        list.appendChild(row);
      });
      sec.appendChild(list);
      wrap.appendChild(sec);
    }
    if (!wrap.isConnected) {
      content.innerHTML = "";
      content.appendChild(wrap);
    }
    clearTimeout(timer);
    // cât timp se descarcă ceva, progresul se actualizează singur
    if (active) timer = setTimeout(() => seq === viewSeq && refresh(), 3000);
  };
  refresh();
}
