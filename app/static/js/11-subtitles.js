/* Cinema — subtitrări automate.
   Scripturi clasice încărcate în ordine (index.html): împart același spațiu global. */
"use strict";

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

/* peste această mărime nu extragem automat subtitrările din MKV: ffmpeg ar descărca tot
   fișierul (zeci de GB) în paralel cu redarea și ar provoca buffering */
const MUX_AUTO_MAX_BYTES = 4e9;
const fmtGB = (b) => (b / 1e9).toFixed(b >= 1e10 ? 0 : 1) + " GB";

function attachSubtitles(video, t, data, season, episode, source = {}, ctx = { alive: true, onStop: [] }) {
  const ccEl = $("#cc-state");
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
  // onNone: ce facem dacă nici OpenSubtitles nu are (ex. oferim extragerea manuală)
  const tryExternal = (onNone = () => setState("CC: niciuna", false)) => {
    const q = [t.name, season ? `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}` : "", t.year || ""]
      .filter(Boolean)
      .join(" ");
    setState("CC…", false);
    fetch(`/api/subtitles/file?q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.text() : null))
      .then((vtt) => {
        if (!ctx.alive) return;
        if (vtt && vtt.includes("-->")) {
          addRuTrack(video, `/api/subtitles/file?q=${encodeURIComponent(q)}`, "RU");
          setState("CC RU ✓", true);
        } else {
          onNone();
        }
      })
      .catch(() => ctx.alive && onNone());
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
    const enc = encodeURIComponent(data.stream_url);
    const statusUrl = `/api/subtitles/mux?url=${enc}`;
    const dataUrl = `/api/subtitles/mux/data?url=${enc}`;
    let started = false;
    // la închidere/altă versiune: oprim ffmpeg pe server (altfel citește tot fișierul degeaba)
    ctx.onStop.push(() => {
      if (started) fetch(statusUrl, { method: "DELETE", keepalive: true }).catch(() => {});
    });
    const poll = async (start = true) => {
      if (!ctx.alive) return; // player închis sau alt fișier ales — oprim verificarea
      try {
        const st = await fetch(start ? statusUrl : `${statusUrl}&start=0`).then((r) => r.json());
        if (!ctx.alive) return;
        if (st.status === "running") started = true;
        if (st.status === "done") {
          addRuTrack(video, dataUrl, "RU");
          setState("CC RU ✓", true);
        } else if (st.status === "running") {
          setState(st.pct > 0 ? `CC… se extrag ${st.pct}%` : "CC… se extrag", false);
          setTimeout(poll, 3000);
        } else if (st.status === "idle") {
          // fișier mare, nimic în cache: încercăm OpenSubtitles, apoi oferim extragerea manuală
          tryExternal(offerManual);
        } else {
          tryExternal();
        }
      } catch (_) {
        if (ctx.alive) tryExternal();
      }
    };
    const offerManual = () => {
      if (!ctx.alive || !ccEl) return;
      setState("CC: niciuna", false);
      const b = document.createElement("button");
      b.className = "btn small ghost";
      b.id = "cc-extract";
      b.title = "ffmpeg descarcă tot fișierul ca să scoată subtitrările — poate încetini redarea";
      b.textContent = `Extrage CC din MKV (${data.size ? fmtGB(data.size) : "fișier mare"})`;
      b.addEventListener("click", () => {
        b.remove();
        setState("CC… se extrag", false);
        poll(true);
      });
      ccEl.after(b);
    };

    if (data.size && data.size <= MUX_AUTO_MAX_BYTES) {
      setState("CC… se extrag", false);
      poll(true); // fișier mic: extragere automată, ca până acum
    } else {
      setState("CC…", false);
      poll(false); // doar verificăm cache-ul / un job deja pornit — fără să pornim ffmpeg
    }
    return;
  }

  tryExternal();
}
