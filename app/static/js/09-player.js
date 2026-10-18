/* Cinema — versiuni (torrente) și player-ul.
   Scripturi clasice încărcate în ordine (index.html): împart același spațiu global. */
"use strict";

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
  attachAudioTracks(video, t, data, ctx);

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
