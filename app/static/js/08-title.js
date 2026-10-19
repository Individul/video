/* Cinema — pagina titlului: trailer, detalii, actori, episoade.
   Scripturi clasice încărcate în ordine (index.html): împart același spațiu global. */
"use strict";

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
      // serial: unde ești acum (ultimul episod pornit) sau, dacă l-ai terminat, episodul următor;
      // film: ultima poziție neterminată (un film văzut până la capăt nu mai e „de continuat”)
      const latest = hist[0];
      const next = isSeries && latest && latest.episode != null && isFinishedEp(latest)
        ? nextEpisodeOf(t.seasons, latest.season, latest.episode)
        : null;
      const last = next
        ? { ...next, position_seconds: 0 }
        : isSeries && latest && isEpisodeInProgress(latest) ? latest : hist.find(isUnfinished);
      if (!last) return;
      const chip = modalBody.querySelector("#resume-chip");
      if (!chip) return;
      const label = last.season ? `S${last.season}E${last.episode} · ` : "";
      chip.innerHTML = next
        ? `▶ Urmează: S${next.season}E${next.episode} <button class="btn small">Pornește</button>`
        : `⏱ Ultima redare: ${label}${fmtTime(last.position_seconds)}
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

  const watchedHtml = (h) => {
    if (!h || !h.duration_seconds) return "";
    const pct = Math.min(100, Math.round((h.position_seconds / h.duration_seconds) * 100));
    return pct >= 92 ? `<div class="ep-done">${svg(I.check, 14)} văzut</div>` : `<div class="ep-progress"><i style="width:${pct}%"></i></div>`;
  };
  // progresul salvat în timpul redării (player-ul trimite „cinema:progress”) apare pe loc pe card
  const onProgress = (ev) => {
    const p = ev.detail;
    if (ds !== detailSeq) return window.removeEventListener("cinema:progress", onProgress); // alt titlu
    if (p.title_id !== t.id || p.season == null || p.episode == null) return;
    const key = `${p.season}x${p.episode}`;
    byEp.set(key, { ...(byEp.get(key) || {}), ...p });
    const thumb = grid.querySelector(`.ep-card[data-ep="${key}"] .ep-thumb`);
    if (!thumb) return;
    thumb.querySelectorAll(".ep-done, .ep-progress").forEach((x) => x.remove());
    thumb.insertAdjacentHTML("beforeend", watchedHtml(byEp.get(key)));
  };
  window.addEventListener("cinema:progress", onProgress);

  function renderSeason(eps, s) {
    const shown = { count: CHUNK };
    const draw = () => {
      grid.innerHTML = "";
      eps.slice(0, shown.count).forEach((e) => {
        // episod încă neapărut (data TMDB în viitor): data pe card, fără pornire degeaba
        const upcoming = e.air_date && e.air_date > new Date().toISOString().slice(0, 10);
        const airLabel = upcoming
          ? new Date(e.air_date + "T12:00:00").toLocaleDateString("ro-RO", { day: "numeric", month: "short", ...(e.air_date.slice(0, 4) !== String(new Date().getFullYear()) ? { year: "numeric" } : {}) })
          : "";
        const watched = upcoming
          ? `<div class="ep-date">${svg(I.calendar || "M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14z", 13)} Iese ${esc(airLabel)}</div>`
          : watchedHtml(byEp.get(`${e.season}x${e.episode}`));
        const el = document.createElement("div");
        el.className = "ep-card" + (upcoming ? " ep-upcoming" : "");
        el.dataset.ep = `${e.season}x${e.episode}`;
        el.innerHTML = `
          <div class="ep-thumb">
            ${e.still ? `<img loading="lazy" decoding="async" alt="" src="${escUrl(e.still)}">` : `<div class="noimg">S${e.season}E${e.episode}</div>`}
            <div class="ep-play">${svg(I.play, 26)}</div>
            ${watched}
          </div>
          <div class="ep-name">${e.episode}. ${esc(e.name || "Episodul " + e.episode)}</div>`;
        if (upcoming) makeActivatable(el, () => toast(`Episodul ${e.episode} iese pe ${airLabel}`), `Episodul ${e.episode}: iese pe ${airLabel}`);
        else makeActivatable(el, () => playEpisode(t, e.season, e.episode), `Redă episodul ${e.episode}`);
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
