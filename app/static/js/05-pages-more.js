/* Cinema — Sport, Căutare torrente, Calendar, Descărcări.
   Scripturi clasice încărcate în ordine (index.html): împart același spațiu global. */
"use strict";

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
  // data scurtă pe fiecare rând (ex. „dum. 18 oct.”), ca să se vadă și fără titlul zilei
  const shortDay = (d) =>
    d ? new Date(d + "T12:00:00").toLocaleDateString("ro-RO", { weekday: "short", day: "numeric", month: "short" }) : "";

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
          <div class="sp-comp">${flagImg(spFlag(m))}${esc(m.competition)}</div>
          <div class="sp-main">
            <div class="sp-match">${esc(m.match)}${m.date ? `<span class="sp-date">${esc(shortDay(m.date))}</span>` : ""}</div>
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
