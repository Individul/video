/* Cinema — piste audio (dublaje) prin MSE.
   Scripturi clasice încărcate în ordine (index.html): împart același spațiu global. */
"use strict";

/* ---------- piste audio (dublaje) ----------
   Browserul redă doar prima pistă audio din MKV și nu știe AC3/DTS. La altă pistă, serverul
   copiază video-ul și convertește pista aleasă în AAC (MP4 fragmentat cu timpii originali);
   aici îl punem prin MSE exact la pozițiile reale, deci restul player-ului nu vede diferența. */
const LANG_NAMES = { rus: "Русский", ru: "Русский", eng: "English", en: "English", ukr: "Українська", uk: "Українська", rum: "Română", ron: "Română", jpn: "日本語", ger: "Deutsch", fre: "Français", spa: "Español", ita: "Italiano" };
const audioLabel = (tr) => {
  const lang = LANG_NAMES[tr.lang] || (tr.lang && tr.lang !== "und" ? tr.lang : "");
  const name = [tr.title, lang].filter(Boolean).join(" · ") || `Pista ${tr.index + 1}`;
  const ch = tr.channels > 2 ? ` ${tr.channels === 6 ? "5.1" : tr.channels === 8 ? "7.1" : tr.channels + "ch"}` : "";
  return `${tr.index + 1}. ${name} — ${tr.codec.toUpperCase()}${ch}`;
};

// iPhone/iPad (iOS 17.1+) au ManagedMediaSource în loc de MediaSource (același mod de lucru)
const MSE_CLASS = window.ManagedMediaSource || window.MediaSource;
const IS_MANAGED_MSE = !!window.ManagedMediaSource && MSE_CLASS === window.ManagedMediaSource;
/* Safari (iPhone/iPad/Mac) nu redă deloc containerele MKV/AVI: acolo fișierul trece din prima
   prin conversia de pe server (video copiat, sunet AAC, MP4 fragmentat) */
const APPLE_WEBKIT = /Apple/.test(navigator.vendor || "");
function nativeContainerOk(name) {
  return !(APPLE_WEBKIT && /\.(mkv|avi|wmv|flv)$/i.test(name || ""));
}

function mseAudioPlayer(video, { url, track, codecs, duration, startAt }) {
  const ms = new MSE_CLASS();
  // iOS: fără asta ManagedMediaSource cere o sursă alternativă pentru AirPlay și nu pornește
  if (IS_MANAGED_MSE) video.disableRemotePlayback = true;
  const MAX_AHEAD = IS_MANAGED_MSE ? 60 : 120; // telefonul are mai puțină memorie
  const objUrl = URL.createObjectURL(ms);
  let sb = null, gen = 0, ctrl = null, loadingFrom = null, destroyed = false;
  const opened = new Promise((res) => ms.addEventListener("sourceopen", res, { once: true }));
  const idle = () => (sb && sb.updating ? new Promise((r) => sb.addEventListener("updateend", r, { once: true })) : Promise.resolve());
  const sleep = (ms_) => new Promise((r) => setTimeout(r, ms_));
  const ahead = () => {
    const b = video.buffered, t = video.currentTime;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i) - t;
    return 0;
  };
  const buffered = (t) => {
    const b = video.buffered;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t && b.end(i) > t + 0.3) return true;
    return false;
  };
  const append = async (chunk) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await idle();
      try {
        sb.appendBuffer(chunk);
        return;
      } catch (e) {
        if (e.name !== "QuotaExceededError") throw e;
        // memorie plină: aruncăm ce e în urmă cu peste 20 s și reîncercăm
        await idle();
        const back = video.currentTime - 20;
        if (back > 0) sb.remove(0, back);
        await sleep(500);
      }
    }
  };
  const load = async (from) => {
    const my = ++gen;
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    loadingFrom = from;
    await opened;
    if (my !== gen || destroyed) return;
    if (!sb) {
      sb = ms.addSourceBuffer(`video/mp4; codecs="${codecs}"`);
      if (duration) ms.duration = duration;
    }
    await idle();
    try {
      sb.abort();
    } catch (_) {}
    if (sb.buffered.length) {
      sb.remove(0, ms.duration || 1e9);
      await idle();
    }
    let res;
    try {
      res = await fetch(`/api/audio/stream?url=${encodeURIComponent(url)}&a=${track}&t=${from.toFixed(2)}`, { signal: ctrl.signal });
    } catch (_) {
      return;
    }
    if (!res.ok || !res.body) return console.warn("audio: conversia nu a pornit", res.status);
    // fluxul începe la cadrul-cheie dinaintea lui `from`, cu timpii de la zero: îl mutăm la locul lui
    await idle();
    sb.timestampOffset = parseFloat(res.headers.get("X-Media-Start")) || from;
    const reader = res.body.getReader();
    try {
      while (my === gen && !destroyed) {
        // nu luăm mai mult de ~2 min în avans; în urmă păstrăm 30 s
        while (ahead() > MAX_AHEAD && my === gen && !destroyed) await sleep(1000);
        const { value, done } = await reader.read();
        if (done || my !== gen || destroyed) break;
        await append(value);
        const back = video.currentTime - 30;
        if (back > 0 && sb.buffered.length && sb.buffered.start(0) < back - 10) {
          await idle();
          sb.remove(0, back);
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") console.warn("audio:", e);
    } finally {
      reader.cancel().catch(() => {});
      if (my === gen) loadingFrom = null;
    }
  };
  // derulare în afara a ce e încărcat → conversie nouă de la acea poziție
  const onSeeking = () => {
    const t = video.currentTime;
    if (buffered(t)) return;
    if (loadingFrom != null && Math.abs(t - loadingFrom) < 1.5) return;
    load(t);
  };
  video.addEventListener("seeking", onSeeking);
  // iPhone (ManagedMediaSource) aruncă singur din memorie bucăți deja încărcate; dacă player-ul
  // stă > 2 s la o poziție fără date, repornim conversia de acolo (altfel ar rămâne în buffer)
  let stallTimer = null;
  const onWaiting = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      const t = video.currentTime;
      if (destroyed || buffered(t) || video.paused) return;
      console.warn(`audio: fără date la ${Math.round(t)}s, reîncarc de acolo`);
      load(t);
    }, 2000);
  };
  const onPlaying = () => clearTimeout(stallTimer);
  video.addEventListener("waiting", onWaiting);
  video.addEventListener("playing", onPlaying);
  video.src = objUrl;
  load(startAt);
  video.addEventListener("loadedmetadata", () => (video.currentTime = startAt), { once: true });
  return {
    destroy() {
      destroyed = true;
      gen++;
      if (ctrl) ctrl.abort();
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      clearTimeout(stallTimer);
      URL.revokeObjectURL(objUrl);
      fetch("/api/audio/stream", { method: "DELETE", keepalive: true }).catch(() => {});
    },
  };
}

/* poate browserul acesta reda direct codec-ul audio? (Edge pe Windows știe AC3/E-AC3, Chrome nu) */
const AUDIO_MIME = { ac3: "ac-3", eac3: "ec-3", aac: "mp4a.40.2", mp3: "mp4a.69", opus: "opus", flac: "flac" };
function browserPlaysAudio(codec) {
  const c = AUDIO_MIME[codec];
  if (!c) return false; // DTS, TrueHD, PCM...: niciun browser
  try {
    return (
      (MSE_CLASS && MSE_CLASS.isTypeSupported(`audio/mp4; codecs="${c}"`)) ||
      !!document.createElement("video").canPlayType(`audio/mp4; codecs="${c}"`)
    );
  } catch (_) {
    return false;
  }
}

function attachAudioTracks(video, t, data, ctx) {
  if (!data.stream_url || !MSE_CLASS) return;
  const blocked = !nativeContainerOk(data.name); // Safari + MKV: doar prin conversie
  const ccBtn = $("#c-cc");
  if (!ccBtn) return;
  const btn = document.createElement("button");
  btn.className = "cbtn txt hidden";
  btn.id = "c-audio";
  btn.title = "Pista audio (dublaj)";
  btn.textContent = "Audio";
  ccBtn.before(btn);
  const pop = document.createElement("div");
  pop.className = "cin-pop audio-pop hidden";
  pop.innerHTML = `<div class="cin-pop-title">Pista audio</div><div class="cin-pop-list"></div><div class="cc-state audio-note"></div>`;
  ccBtn.closest(".cin-video").appendChild(pop);
  const list = pop.querySelector(".cin-pop-list"), note = pop.querySelector(".audio-note");

  let info = null, current = 0, mse = null;
  const prefKey = `audio:${t.id}`;
  const remember = (tr) => {
    try {
      localStorage.setItem(prefKey, JSON.stringify({ lang: tr.lang, title: tr.title }));
    } catch (_) {}
  };
  const recalled = () => {
    try {
      return JSON.parse(localStorage.getItem(prefKey));
    } catch (_) {
      return null;
    }
  };

  const select = (idx, { save = true } = {}) => {
    const tr = info.tracks[idx];
    if (!tr || (idx === current && (mse || (tr.native && !blocked)))) return;
    const pos = video.currentTime || +video.dataset.seekTo || 0;
    video.closest(".cin-video")?.querySelector("#video-error")?.classList.add("hidden");
    const wasPaused = video.paused && pos > 0;
    if (mse) {
      mse.destroy();
      mse = null;
    }
    if (idx === 0 && tr.native && !blocked) {
      // prima pistă o redă browserul direct, fără conversie
      video.src = data.stream_url;
      video.addEventListener("loadedmetadata", () => (video.currentTime = pos), { once: true });
    } else {
      mse = mseAudioPlayer(video, { url: data.stream_url, track: idx, codecs: info.mse_codecs, duration: info.duration, startAt: pos });
    }
    if (!wasPaused) video.play().catch(() => {});
    current = idx;
    if (save) remember(tr);
    render();
    if (save) toast(`Audio: ${audioLabel(tr)}`); // alegerile automate nu mai anunță nimic
  };

  const render = () => {
    list.innerHTML = "";
    info.tracks.forEach((tr) => {
      const b = document.createElement("button");
      b.textContent = audioLabel(tr);
      b.classList.toggle("on", tr.index === current);
      b.addEventListener("click", () => {
        pop.classList.add("hidden");
        select(tr.index);
      });
      list.appendChild(b);
    });
    note.textContent = current !== 0 || !info.tracks[0].native || blocked ? "convertită pe server în AAC stereo" : "";
  };

  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    document.querySelectorAll(".cin-pop").forEach((p) => p !== pop && p.classList.add("hidden"));
    pop.classList.toggle("hidden");
  });
  pop.addEventListener("click", (ev) => ev.stopPropagation());
  const outside = () => pop.classList.add("hidden");
  document.addEventListener("click", outside);
  ctx.onStop.push(() => {
    document.removeEventListener("click", outside);
    if (mse) mse.destroy();
  });

  // pistele le citim abia după ce filmul a pornit: ffprobe pe torrent nu concurează cu începutul
  const loadTracks = () => api(`/api/audio/tracks?url=${encodeURIComponent(data.stream_url)}`)
    .then((r) => {
      if (!ctx.alive || !r.tracks || !r.tracks.length) return;
      r.tracks.forEach((tr) => (tr.native = tr.native || browserPlaysAudio(tr.codec)));
      info = r;
      const pref = recalled();
      const match = pref && info.tracks.find((x) => x.lang === pref.lang && x.title === pref.title);
      if (!info.mse_codecs) {
        // HEVC & co.: browserul redă oricum doar prima pistă; pe Safari MKV-ul nu merge deloc
        if (blocked) {
          $("#buffer")?.classList.add("hidden");
          const box = video.closest(".cin-video")?.querySelector("#video-error");
          if (box) {
            box.textContent = "Safari (iPhone/iPad) nu poate reda acest fișier: MKV cu video HEVC sau 10-bit, pe care serverul nu-l poate converti. Alege din „Versiuni” o variantă „Mobil” sau H.264.";
            box.classList.remove("hidden");
          }
        }
        return;
      }
      const first = info.tracks[0];
      if (blocked) {
        // Safari + MKV: pornim direct prin conversie, pe pista ținută minte sau pe prima
        if (info.tracks.length > 1) btn.classList.remove("hidden");
        select(match ? match.index : 0, { save: false });
        return;
      }
      if (info.tracks.length < 2 && first.native) return; // o singură pistă, deja redată
      btn.classList.remove("hidden");
      render();
      // pista aleasă data trecută la acest titlu (aceeași limbă + titlu), apoi codec nesuportat
      if (match && match.index !== 0) select(match.index, { save: false });
      else if (!first.native) select(0, { save: false }); // DTS & co.: altfel n-ar avea sunet
    })
    .catch(() => {});
  let loaded = false;
  const once = () => {
    if (loaded || !ctx.alive) return;
    loaded = true;
    loadTracks();
  };
  if (blocked) return once(); // n-avem redare directă de așteptat: citim pistele imediat
  video.addEventListener("playing", once, { once: true });
  // fișier pe care browserul nu-l poate reda deloc (ex. doar DTS): citim pistele oricum
  video.addEventListener("error", once, { once: true });
  setTimeout(once, 20000);
}
