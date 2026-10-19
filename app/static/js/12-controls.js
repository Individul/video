/* Cinema — comenzile player-ului și istoricul de progres.
   Scripturi clasice încărcate în ordine (index.html): împart același spațiu global. */
"use strict";

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
  const send = (pos, dur) => {
    // pagina titlului (grila de episoade) își actualizează progresul pe loc, fără reîncărcare
    if (t.id)
      window.dispatchEvent(new CustomEvent("cinema:progress", {
        detail: { title_id: t.id, season: season ?? null, episode: episode ?? null, position_seconds: pos, duration_seconds: dur || null },
      }));
    return sendHistory(pos, dur);
  };
  const sendHistory = (pos, dur) =>
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
