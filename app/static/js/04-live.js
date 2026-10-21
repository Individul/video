/* Cinema — Live: Ace Stream prin hls.js.
   Scripturi clasice încărcate în ordine (index.html): împart același spațiu global. */
"use strict";

/* ================= LIVE (Ace Stream) ================= */
let liveLeague = "all"; // filtrul pe competiție rămâne la întoarcerea pe pagină

async function loadLive() {
  const seq = viewSeq;
  content.innerHTML = `
    <div class="grid-wrap live-page">
      <div class="lv-head">
        <div class="view-title">Live</div>
        <span class="lv-sub">Ace Stream · ora Moscovei</span>
        <button class="lv-refresh" type="button" id="live-ev-refresh" title="Reîmprospătează">
          ${svg("M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z", 15)}
          <span id="live-ev-age">se încarcă…</span>
        </button>
      </div>
      <div class="q-filter lv-filter" id="live-filter"></div>
      <div id="live-events"><div class="status">Se încarcă…</div></div>

      <div class="lv-sec">Canalele mele</div>
      <div class="lv-mine">
        <form class="lv-box" id="live-form">
          <div class="lv-box-title">Link propriu</div>
          <input id="live-ref" placeholder="acestream://… sau ID de 40 de caractere" autocomplete="off">
          <input id="live-name" placeholder="Nume (opțional, pentru salvare)" autocomplete="off">
          <div class="lv-actions">
            <button class="btn" type="submit">${svg(I.play, 14)} Pornește</button>
            <button class="btn ghost" type="button" id="live-save">Salvează</button>
          </div>
        </form>
        <div class="lv-box">
          <div class="lv-box-title">Salvate</div>
          <div id="live-list"><div class="status">Se încarcă…</div></div>
        </div>
      </div>
    </div>`;
  const refEl = $("#live-ref"), nameEl = $("#live-name");
  let events = [];
  let loadedAt = 0;

  const playBtn = (label = "Pornește") => `<button class="sp-var" data-a="play">${svg(I.play, 13)} <b>${label}</b></button>`;
  const meta = (ev) => `${flagImg(ev.flag)}${[ev.league, ev.channel].filter(Boolean).map(esc).join(" · ")}`;

  const drawEvents = () => {
    const box = $("#live-events"), filter = $("#live-filter");
    if (!box) return;
    if (!events.length) {
      filter.innerHTML = "";
      box.innerHTML = `<div class="status">Niciun eveniment momentan.</div>`;
      return;
    }
    // filtre pe competiție (cele mai frecvente primele)
    const counts = {};
    events.forEach((e) => (counts[e.league || "Altele"] = (counts[e.league || "Altele"] || 0) + 1));
    const leagues = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    if (liveLeague !== "all" && !counts[liveLeague]) liveLeague = "all";
    filter.innerHTML = leagues.length > 1
      ? [["all", `Toate ${events.length}`], ...leagues.map((l) => [l, `${l} ${counts[l]}`])]
          .map(([v, l]) => `<button data-l="${esc(v)}" class="${v === liveLeague ? "on" : ""}">${esc(l)}</button>`)
          .join("")
      : "";
    filter.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        liveLeague = b.dataset.l;
        drawEvents();
      })
    );

    const shown = events.filter((e) => liveLeague === "all" || (e.league || "Altele") === liveLeague);
    const live = shown.filter((e) => e.is_live);
    const later = shown.filter((e) => !e.is_live);
    const onPlay = (el, ev) =>
      el.querySelector('[data-a="play"]').addEventListener("click", () =>
        playLive({ name: `${ev.home} – ${ev.away}`, url: ev.url })
      );
    box.innerHTML = "";

    if (live.length) {
      box.insertAdjacentHTML("beforeend", `<div class="lv-sec"><span class="lv-dot"></span>În direct acum <small>${live.length}</small></div>`);
      const tiles = document.createElement("div");
      // plăcile umplu mereu lățimea listei: 1 = banner lat, 2–3 = coloane egale, 4+ = câte încap
      tiles.className = `lv-tiles ${live.length <= 3 ? "n" + live.length : "nmany"}`;
      if (live.length > 3) {
        // rânduri echilibrate (5 → 3+2, 7 → 4+3), fără o placă singură pe ultimul rând
        const rows = Math.ceil(live.length / 4);
        tiles.style.setProperty("--lv-cols", Math.ceil(live.length / rows));
      }
      live.forEach((ev) => {
        const tile = document.createElement("div");
        tile.className = "lv-tile";
        tile.innerHTML = `
          <div class="lv-tile-body">
            <span class="lv-badge">LIVE${ev.when ? ` · ${esc(ev.when)}` : ""}</span>
            <div class="lv-teams">${esc(ev.home)} – ${esc(ev.away)}</div>
            <div class="lv-meta">${meta(ev)}</div>
          </div>
          <div class="lv-tile-foot">${playBtn()}</div>`;
        onPlay(tile, ev);
        tiles.appendChild(tile);
      });
      box.appendChild(tiles);
    }

    if (later.length) {
      box.insertAdjacentHTML("beforeend", `<div class="lv-sec">Urmează <small>${later.length}</small></div>`);
      let lastDay = "";
      later.forEach((ev) => {
        if (ev.day !== lastDay) {
          lastDay = ev.day;
          box.insertAdjacentHTML("beforeend", `<div class="lv-day">${esc(ev.day || "")}</div>`);
        }
        const row = document.createElement("div");
        row.className = "lv-row";
        row.innerHTML = `
          <span class="lv-time">${esc(ev.when || "—")}</span>
          <div class="lv-main"><div class="lv-teams">${esc(ev.home)} – ${esc(ev.away)}</div><div class="lv-meta">${meta(ev)}</div></div>
          ${playBtn()}`;
        onPlay(row, ev);
        box.appendChild(row);
      });
    }
    if (!live.length && !later.length) box.innerHTML = `<div class="status">Nimic la această competiție.</div>`;
  };

  // „actualizat acum 20 s” — se reîmprospătează singur la 65 s
  const ageEl = () => $("#live-ev-age");
  const showAge = () => {
    const el = ageEl();
    if (!el || !loadedAt) return;
    const s = Math.round((Date.now() - loadedAt) / 1000);
    el.textContent = s < 5 ? "actualizat acum" : s < 60 ? `actualizat acum ${s} s` : `actualizat acum ${Math.round(s / 60)} min`;
  };
  const loadEvents = async (silent = false) => {
    const box = $("#live-events");
    if (!box) return;
    if (!silent && ageEl()) ageEl().textContent = "se încarcă…";
    try {
      const evs = await api("/api/live/events");
      if (seq !== viewSeq) return;
      events = evs;
      loadedAt = Date.now();
      drawEvents();
      showAge();
    } catch (err) {
      // la reîmprospătarea automată păstrăm lista veche (o eroare de moment nu o șterge)
      if (!silent && seq === viewSeq) box.innerHTML = `<div class="status error">${esc(err.message)}</div>`;
    }
  };

  const drawList = (items) => {
    const box = $("#live-list");
    if (!box) return;
    if (!items.length) {
      box.innerHTML = `<div class="lv-empty">Niciun canal salvat. Lipește un ID în stânga și apasă „Salvează”.</div>`;
      return;
    }
    box.innerHTML = "";
    items.forEach((c) => {
      const row = document.createElement("div");
      row.className = "lv-saved";
      row.innerHTML = `
        <div class="lv-main"><div class="lv-saved-name">${esc(c.name)}</div><div class="lv-meta">${esc(c.kind === "infohash" ? "infohash" : "acestream")} · ${esc(c.hash.slice(0, 12))}…</div></div>
        <button class="lv-icon" data-a="play" title="Pornește">${svg(I.play, 15)}</button>
        <button class="lv-icon" data-a="del" title="Șterge canalul">${svg(I.trash, 15)}</button>`;
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
  $("#live-ev-refresh").addEventListener("click", () => loadEvents());
  loadEvents(); // în paralel cu canalele salvate de mai jos
  // auto-reîmprospătat cât timp pagina e deschisă (65 s > cache-ul serverului de 60 s);
  // timerul se oprește singur când navigăm în altă parte (seq != viewSeq)
  const evTimer = setInterval(() => {
    if (seq !== viewSeq) return clearInterval(evTimer);
    loadEvents(true);
  }, 65000);
  const ageTimer = setInterval(() => {
    if (seq !== viewSeq) return clearInterval(ageTimer);
    showAge();
  }, 10000);
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

async function playLive({ name, ref, url }) {
  enterCinema({ id: null, name, type: "movie" });
  cinema.classList.add("cin-live"); // fără versiuni/stare torrent: doar player-ul
  $("#cin-sub").textContent = "Live · Ace Stream";
  const ps = beginPlay();
  const playerBox = $("#player");
  if (!playerBox) return;
  playerBox.innerHTML = `<div class="cin-status">Conectare la rețeaua Ace Stream…<small>prima pornire poate dura 10–30 s</small></div>`;
  let sess;
  try {
    // url = eveniment pimpletv (serverul rezolvă pagina la ID); ref = ID direct
    sess = await (url
      ? api("/api/live/events/play", { method: "POST", body: JSON.stringify({ url }) })
      : api("/api/live/start", { method: "POST", body: JSON.stringify({ ref }) }));
  } catch (err) {
    if (ps === playSeq) playerBox.innerHTML = `<div class="cin-status error">${esc(err.message)}</div>`;
    return;
  }
  const stopSession = () =>
    api(`/api/live/stop/${sess.infohash}/${sess.session}`, { method: "POST", keepalive: true }).catch(() => {});
  if (ps !== playSeq) return stopSession();

  // hls.js peste tot unde merge (Chrome/Edge au acum HLS nativ, dar slab la live);
  // HLS-ul nativ rămâne doar pentru Safari/iOS
  let Hls = null;
  try {
    Hls = await loadHls();
  } catch (_) {}
  if (ps !== playSeq) return stopSession();
  if (!Hls || !Hls.isSupported()) {
    Hls = null;
    if (!document.createElement("video").canPlayType("application/vnd.apple.mpegurl")) {
      stopSession();
      playerBox.innerHTML = `<div class="cin-status error">Browserul nu poate reda transmisia (HLS)</div>`;
      return;
    }
  }

  const ctx = { alive: true, onStop: [] };
  playerBox.innerHTML = playerHtml();
  playerBox.querySelector(".cin-video").classList.add("is-live");
  const video = playerBox.querySelector("#video");
  $("#buffer").classList.remove("hidden");

  // statistici: peers, viteză, prebuffering; serverul raportează și segmentele cu găuri în audio
  const gapSegs = new Map(); // nr. segment -> secunde de audio lipsă
  const refreshLive = async () => {
    if (!ctx.alive) return;
    try {
      const s = await api(`/api/live/stat/${sess.infohash}/${sess.session}`);
      if (!ctx.alive) return;
      (s.audio_gaps || []).forEach(([n, sec]) => gapSegs.set(n, sec));
      const pre = s.status === "prebuf" ? ` · prebuffering ${s.progress || 0}%` : "";
      $("#cin-mini").innerHTML = `<span class="dot-${s.peers > 2 ? "ok" : s.peers ? "mid" : "bad"}"></span>${sess.is_live ? "LIVE · " : ""}${s.peers} peers · ↓ ${fmtMbit(s.down_bps)} Mbit/s${pre}`;
    } catch (_) {}
  };
  refreshLive();
  const statTimer = setInterval(refreshLive, 3000);

  let hls = null;
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

  // Rezervă înainte de pornire: P2P-ul live vine doar cu viteza transmisiei, deci rezerva
  // nu mai crește după start. Așteptăm ~30 s de segmente (ca player-ul Ace Stream local).
  const NEED = 6;
  const sub = $("#cin-sub");
  const waitFrom = Date.now();
  while (ctx.alive && Date.now() - waitFrom < 90000) {
    let n = 0;
    try {
      const r = await fetch(sess.playlist, { cache: "no-store" });
      if (r.ok) n = ((await r.text()).match(/#EXTINF/g) || []).length;
    } catch (_) {}
    if (!ctx.alive) return;
    if (n >= NEED) break;
    sub.textContent = `Live · acumulez rezervă ${Math.min(n, NEED)}/${NEED}`;
    await new Promise((res) => setTimeout(res, 2500));
  }
  if (!ctx.alive) return;

  // sunet pe care browserul nu-l știe (MP2 la canalele prin satelit, AC3): serverul retransmite
  // prin ffmpeg cu sunetul în AAC; video-ul și rezerva rămân aceleași
  let streamInfo = {};
  try {
    const prep = await api(`/api/live/prepare/${sess.infohash}/${sess.session}`, { method: "POST" });
    if (!ctx.alive) return;
    streamInfo = prep;
    if (prep.relay) {
      console.warn(`live: sunet ${prep.audio} → retransmisie cu AAC`);
      sess.playlist = prep.playlist;
      for (let i = 0; i < 20 && ctx.alive; i++) {
        sub.textContent = prep.audio === "aac"
          ? "Live · pregătesc sunetul (fără goluri)…"
          : `Live · convertesc sunetul (${prep.audio.toUpperCase()} → AAC)…`;
        const r = await fetch(sess.playlist, { cache: "no-store" }).catch(() => null);
        if (r && r.ok && ((await r.text()).match(/#EXTINF/g) || []).length >= 4) break;
        await new Promise((res) => setTimeout(res, 1500));
      }
      if (!ctx.alive) return;
    }
  } catch (err) {
    console.warn("live: verificarea sunetului a eșuat", err);
  }
  sub.textContent = "Live · Ace Stream";

  if (Hls) {
    // După o oprire lungă sau o eroare media, hls.js „repară din mers” bufferul, iar
    // audio-ul poate ieși dezaliniat (voce de robot). Mai sigur: reconstruim player-ul
    // curat la poziția live (rezerva rămâne, segmentele sunt deja pe server).
    let lastRebuild = 0;
    const rebuild = (force = false) => {
      if (!ctx.alive || (!force && Date.now() - lastRebuild < 15000)) return;
      lastRebuild = Date.now();
      started = false;
      // reluăm din același loc: instanța nouă numără timpul de la zero, așa că ținem minte
      // segmentul curent (numărul lui) și cât am înaintat în el
      const resume = curFrag ? { sn: curFrag.sn, off: Math.max(0, video.currentTime - curFrag.start) } : null;
      try {
        hls.destroy();
      } catch (_) {}
      attach(resume);
    };
    const handledGaps = new Set();
    let decodeFails = 0;
    let lastGapSync = 0;
    let curFrag = null;
    const attach = (resume = null) => {
      hls = new Hls({
        autoStartLoad: !resume,
        liveSyncDurationCount: 5, // pornește ~25 s în urma transmisiei: rezervă pentru căderile P2P
        maxBufferLength: 60,
        backBufferLength: 30,
        lowLatencyMode: false,
        manifestLoadingMaxRetry: 30,
        manifestLoadingRetryDelay: 2000,
        levelLoadingMaxRetry: 10,
        fragLoadingMaxRetry: 10,
      });
      hls.loadSource(sess.playlist);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      if (resume) {
        hls.once(Hls.Events.LEVEL_LOADED, (_, d) => {
          const f = (d.details.fragments || []).find((x) => x.sn === resume.sn);
          hls.startLoad(f ? f.start + resume.off : -1);
        });
      }
      // a trecut de un segment cu gaură audio → resincronizare automată (o dată per gaură)
      hls.on(Hls.Events.FRAG_CHANGED, (_, d) => {
        curFrag = d.frag;
        const sn = d.frag && d.frag.sn;
        if (typeof sn !== "number") return;
        // nu orice gaură strică sunetul: le notăm pe toate, dar resincronizăm doar la cele
        // mari (≥ 1 s), cel mult o dată la 90 s — altfel întreruperile ar fi prea dese
        for (const [g, sec] of gapSegs) {
          if (sn <= g || handledGaps.has(g)) continue;
          handledGaps.add(g);
          if (sn - g > 3) continue;
          const big = sec >= 1 && Date.now() - lastGapSync > 90000;
          console.warn(`live: gaură audio ${sec}s în segmentul ${g}${big ? ", resincronizez" : ""}`);
          if (big) {
            lastGapSync = Date.now();
            rebuild(true);
            break;
          }
        }
      });
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (!ctx.alive) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
          console.warn("live: eroare media", d.details, video.error ? video.error.message : "");
          // decodorul video al browserului refuză fluxul (des la 1080i de satelit): reîncercările
          // n-ajută, iar serverul nu-l poate converti în timp real — spunem clar ce se întâmplă
          if (video.error && /DECODE/i.test(video.error.message) && ++decodeFails >= 2) {
            ctx.alive = false;
            clearInterval(statTimer);
            try {
              hls.destroy();
            } catch (_) {}
            stopSession();
            $("#buffer")?.classList.add("hidden");
            playerBox.querySelector(".cin-video")?.classList.add("live-failed"); // fără play mare peste mesaj
            const box = playerBox.querySelector("#video-error");
            if (box) {
              // acestream:// deschide canalul direct în aplicația Ace Stream de pe calculator
              const open = sess.content_id
                ? `<a class="btn live-open" href="acestream://${esc(sess.content_id)}">${svg(I.play, 16)} Deschide în Ace Stream</a>`
                : "";
              box.innerHTML = (streamInfo.interlaced
                ? "Browserul nu poate decoda video-ul acestui canal (1080i întrețesut, ca la TV prin satelit), iar serverul nu-l poate converti în timp real.<br>Încearcă alt link pentru același meci — de obicei există variante 720p — sau deschide-l în Ace Stream pe calculator."
                : "Browserul nu poate decoda video-ul acestui canal. Încearcă alt link pentru același meci sau deschide-l în Ace Stream pe calculator.") + open;
              box.classList.remove("hidden");
            }
            return;
          }
          if (d.fatal || d.details === "bufferAppendError" || d.details === "fragParsingError") rebuild();
          return;
        }
        if (!d.fatal) {
          console.warn("live:", d.details);
          return;
        }
        const box = playerBox.querySelector("#video-error");
        if (box) {
          box.textContent = "Transmisia nu răspunde (prea puțini peers sau ID expirat). Încearcă din nou sau alt canal.";
          box.classList.remove("hidden");
        }
      });
    };
    attach();
    // oprire (buffer) mai lungă de 3 s → la reluare, reconstruim curat
    let waitingSince = 0;
    let started = false; // prima încărcare nu contează ca „buffer”
    const onWaiting = () => {
      if (started) waitingSince = waitingSince || Date.now();
    };
    const onPlaying = () => {
      started = true;
      const long = waitingSince && Date.now() - waitingSince > 3000;
      waitingSince = 0;
      if (long) {
        console.warn("live: reconstruiesc player-ul după buffer");
        rebuild();
      }
    };
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    // resincronizare manuală (buton sau tasta R): după pierderi de date P2P, decodorul audio
    // din browser poate rămâne stricat (voce de robot) până la o reîncărcare curată
    const resync = () => {
      console.warn("live: resincronizare manuală");
      rebuild(true);
    };
    const pip = playerBox.querySelector("#v-pip");
    const syncBtn = document.createElement("button");
    syncBtn.className = "cbtn";
    syncBtn.title = "Resincronizează (R) — dacă sunetul sau imaginea se strică";
    syncBtn.innerHTML = svg(I.resync, 22);
    syncBtn.addEventListener("click", resync);
    if (pip) pip.before(syncBtn);
    const onKey = (e) => {
      if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA/.test(e.target.tagName)) resync();
    };
    document.addEventListener("keydown", onKey);
    ctx.onStop.push(() => {
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      document.removeEventListener("keydown", onKey);
    });
  } else {
    video.src = sess.playlist; // Safari: HLS nativ
  }

  enhanceVideo(video, { ctx });
}
