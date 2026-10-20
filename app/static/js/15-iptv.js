/* Cinema — TV prin IPTV: canalele din playlistul abonamentului (linkul stă doar pe server).
   Serverul retransmite canalul ales prin ffmpeg (sunet AAC, HLS), playerul e cel de la Live. */
"use strict";

const TV_ICON_STAR = "M12 17.3l-6.2 3.7 1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.8 1.6 7z";
let tvGroup = (() => {
  try {
    return localStorage.getItem("tv-group") || "all";
  } catch (_) {
    return "all";
  }
})();
let tvData = null; // ultimul /api/iptv (pentru canal anterior/următor în player)
let tvShowBad = false; // și canalele care nu merg în browser (verificate de server / raportate)
const TV_ICON_GUIDE = "M3 4h18v2H3zm0 5h12v2H3zm0 5h18v2H3zm0 5h12v2H3z";
let tvNow = {}; // id -> [titlu acum, start, stop, titlu următor, start următor]
const tvHm = (ts) => new Date(ts * 1000).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
const tvDay = (ts) => {
  const d = new Date(ts * 1000), today = new Date();
  const diff = Math.round((new Date(d.toDateString()) - new Date(today.toDateString())) / 864e5);
  if (diff === 0) return "Azi";
  if (diff === -1) return "Ieri";
  if (diff === 1) return "Mâine";
  const s = d.toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long" });
  return s[0].toUpperCase() + s.slice(1);
};
const tvReport = (id, ok) =>
  api(`/api/iptv/report/${id}`, { method: "POST", body: JSON.stringify({ ok }) }).catch(() => {});

async function loadTv(opts = {}) {
  const seq = viewSeq;
  content.innerHTML = `<div class="grid-wrap tv-page"><div class="view-title">TV</div><div class="status">Se încarcă canalele…</div></div>`;
  let data;
  try {
    data = await api(`/api/iptv${opts.refresh ? "?refresh=1" : ""}`);
  } catch (err) {
    if (seq === viewSeq) content.innerHTML = `<div class="grid-wrap tv-page"><div class="view-title">TV</div>
      <div class="status error">${esc(err.message)}</div>
      <div class="tv-actions"><button class="btn ghost small" id="tv-change">Schimbă playlistul</button></div></div>`;
    $("#tv-change")?.addEventListener("click", () => tvSetup());
    return;
  }
  if (seq !== viewSeq) return;
  if (!data.configured) return tvSetup();
  tvData = data;
  const fav = new Set(data.favorites);
  const bad = data.channels.filter((c) => c.state === "bad").length;
  const visible = (c) => tvShowBad || c.state !== "bad";
  const pr = data.probe || {};
  const probeNote = pr.total && pr.done < pr.total
    ? ` · verific ce merge în browser: ${pr.done}/${pr.total}` : "";
  const wrap = document.createElement("div");
  wrap.className = "grid-wrap tv-page";
  wrap.innerHTML = `
    <div class="tv-head">
      <div class="view-title">TV</div>
      <span class="tv-sub">${data.channels.length - (tvShowBad ? 0 : bad)} canale · ${esc(data.source)}${probeNote}</span>
      <div class="tv-actions">
        <button class="btn ghost small" id="tv-refresh" title="Descarcă din nou playlistul">${svg(I.resync, 15)} Actualizează</button>
        <button class="btn ghost small" id="tv-change">Schimbă playlistul</button>
      </div>
    </div>
    <form class="ts-form" id="tv-form">${svg(BK_SEARCH_ICON, 20)}
      <input id="tv-q" type="search" placeholder="Caută canal (ex. Матч, Discovery, Кино)…" autocomplete="off">
    </form>
    <div class="q-filter tv-groups" id="tv-groups"></div>
    <div id="tv-epg"></div>
    <div class="tv-grid" id="tv-grid"></div>`;
  content.innerHTML = "";
  content.appendChild(wrap);
  $("#tv-refresh").addEventListener("click", () => loadTv({ refresh: true }));
  $("#tv-change").addEventListener("click", () => tvSetup(data.source));
  $("#tv-form").addEventListener("submit", (e) => e.preventDefault());

  const input = $("#tv-q"), groupsBox = $("#tv-groups"), grid = $("#tv-grid");
  const vis = data.channels.filter(visible);
  const counts = {};
  vis.forEach((c) => (counts[c.group] = (counts[c.group] || 0) + 1));
  const groups = [["fav", `★ Favorite ${fav.size}`], ["all", `Toate ${vis.length}`],
    ...data.groups.filter((g) => counts[g.name]).map((g) => [g.name, `${g.name} ${counts[g.name]}`])];
  if (!groups.some(([k]) => k === tvGroup) || (tvGroup === "fav" && !fav.size)) tvGroup = fav.size ? "fav" : "all";
  const drawGroups = () => {
    groupsBox.innerHTML = groups
      .filter(([k]) => k !== "fav" || fav.size)
      .map(([k, l]) => `<button data-g="${esc(k)}" class="${k === tvGroup ? "on" : ""}">${esc(k === "fav" ? `★ Favorite ${fav.size}` : l)}</button>`)
      .join("") +
      (bad ? `<button data-toggle="bad" class="tv-badtoggle${tvShowBad ? " on" : ""}" title="Canale pe care browserul nu le poate reda (HD întrețesut, HEVC) sau care nu răspund">${tvShowBad ? "Ascunde" : "Arată"} și cele care nu merg în browser (${bad})</button>` : "");
  };
  const shown = () => {
    const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return data.channels.filter((c) => (visible(c) || fav.has(c.id)) &&
      (words.length ? true : tvGroup === "all" || (tvGroup === "fav" ? fav.has(c.id) : c.group === tvGroup)) &&
      words.every((w) => c.name.toLowerCase().includes(w)));
  };
  const draw = () => {
    const list = shown();
    grid.innerHTML = list.length ? "" : `<div class="status">Niciun canal${input.value ? ` pentru „${esc(input.value)}”` : " aici"}.</div>`;
    const frag = document.createDocumentFragment();
    list.slice(0, 600).forEach((c) => {
      const tile = document.createElement("div");
      tile.className = "tv-tile" + (c.state === "bad" ? " tv-bad" : "");
      tile.innerHTML = `
        <div class="tv-logo">${c.logo ? `<img loading="lazy" alt="" src="${escUrl(c.logo)}">` : ""}<span>${esc(c.name.slice(0, 2))}</span></div>
        <div class="tv-name">${esc(c.name)}</div>
        <div class="tv-now" data-id="${c.id}"></div>
        ${c.catchup_days ? `<div class="tv-arch" title="Arhivă ${c.catchup_days} zile la furnizor">${c.catchup_days}z</div>` : ""}
        <button class="tv-guide-btn" title="Programul canalului${c.catchup_days ? " și arhiva" : ""}">${svg(TV_ICON_GUIDE, 15)}</button>
        <button class="tv-fav${fav.has(c.id) ? " on" : ""}" title="Favorit">${svg(TV_ICON_STAR, 16)}</button>`;
      const img = tile.querySelector("img");
      if (img) img.addEventListener("error", () => img.remove()); // logo lipsă: rămân inițialele
      tile.querySelector(".tv-fav").addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          const r = await api(`/api/iptv/favorites/${c.id}`, { method: "POST" });
          fav.clear();
          r.favorites.forEach((x) => fav.add(x));
          data.favorites = r.favorites;
          drawGroups();
          if (tvGroup === "fav") draw();
          else e.target.closest(".tv-fav").classList.toggle("on", fav.has(c.id));
        } catch (err) {
          toast(err.message, false);
        }
      });
      tile.querySelector(".tv-guide-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        tvGuide(c, list);
      });
      makeActivatable(tile, () => playIptv(c, list), c.name);
      frag.appendChild(tile);
    });
    grid.appendChild(frag);
    paintNow();
    if (list.length > 600) grid.insertAdjacentHTML("beforeend", `<div class="status">… încă ${list.length - 600} canale — caută după nume.</div>`);
  };
  groupsBox.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.toggle === "bad") {
      tvShowBad = !tvShowBad;
      return loadTv();
    }
    tvGroup = b.dataset.g;
    try {
      localStorage.setItem("tv-group", tvGroup);
    } catch (_) {}
    input.value = "";
    drawGroups();
    draw();
  });
  // „Acum” pe carduri: din ghidul TV, reîmprospătat la 2 minute cât stai pe pagină
  const paintNow = () => {
    const t = Date.now() / 1000;
    grid.querySelectorAll(".tv-now").forEach((el) => {
      const n = tvNow[el.dataset.id];
      if (!n || !n[0]) return (el.innerHTML = "");
      const pct = Math.min(100, Math.max(0, ((t - n[1]) / (n[2] - n[1])) * 100));
      el.title = n[3] ? `Urmează la ${tvHm(n[4])}: ${n[3]}` : "";
      el.innerHTML = `<span>${esc(n[0])}</span><i style="width:${pct.toFixed(1)}%"></i>`;
    });
  };
  const loadNow = async () => {
    if (seq !== viewSeq) return;
    try {
      tvNow = (await api("/api/iptv/now")).now || {};
      if (seq === viewSeq) paintNow();
    } catch (_) {}
    setTimeout(loadNow, 120000);
  };
  loadNow();

  // căutarea caută și în program (meciuri, filme): acum, urmează, arhivă
  const epgBox = $("#tv-epg");
  let epgTimer = null, epgSeq = 0;
  const searchEpg = () => {
    clearTimeout(epgTimer);
    const q = input.value.trim();
    if (q.length < 3) return (epgBox.innerHTML = "");
    epgTimer = setTimeout(async () => {
      const my = ++epgSeq;
      epgBox.innerHTML = `<div class="ts-note">Caut în program…</div>`;
      let res;
      try {
        res = await api(`/api/iptv/search?q=${encodeURIComponent(q)}`);
      } catch (err) {
        if (my === epgSeq) epgBox.innerHTML = "";
        return;
      }
      if (my !== epgSeq || seq !== viewSeq) return;
      if (!res.results.length) {
        epgBox.innerHTML = res.epg && !res.epg.loaded ? `<div class="ts-note">Ghidul TV se încarcă (prima dată ~1 minut)…</div>` : "";
        return;
      }
      const byId = new Map(data.channels.map((c) => [c.id, c]));
      epgBox.innerHTML = `<div class="cal-day-head">În program<span>${res.results.length}</span></div><div class="tv-epg-list"></div>`;
      const box = epgBox.querySelector(".tv-epg-list");
      res.results.forEach((r) => {
        const ch = byId.get(r.cid);
        if (!ch) return;
        const row = document.createElement("div");
        row.className = "tv-epg-row" + (r.live ? " live" : r.archive ? " arch" : " soon");
        const when = r.live ? `<b class="tv-badge live">ACUM</b>` : r.archive
          ? `<b class="tv-badge arch">▶ ARHIVĂ</b> ${esc(tvDay(r.start))} ${tvHm(r.start)}`
          : `${esc(tvDay(r.start))} ${tvHm(r.start)}`;
        row.innerHTML = `<div class="tv-epg-when">${when}</div>
          <div class="tv-epg-title">${esc(r.title)}<small>${esc(r.channel)} · ${tvHm(r.start)}–${tvHm(r.stop)}</small></div>`;
        makeActivatable(row, () => {
          if (r.archive) return playIptv(ch, null, false, r.start);
          if (r.live) return playIptv(ch);
          toast(`Începe ${tvDay(r.start).toLowerCase()} la ${tvHm(r.start)} pe ${r.channel}`);
        }, r.title);
        box.appendChild(row);
      });
    }, 400);
  };
  input.addEventListener("input", () => {
    draw();
    searchEpg();
  });
  drawGroups();
  draw();
}

/* linkul playlistului: îl lipești tu, rămâne pe server */
function tvSetup(current) {
  content.innerHTML = `
    <div class="grid-wrap tv-page">
      <div class="view-title">TV</div>
      <div class="tv-setup">
        <h3>Adaugă playlistul abonamentului IPTV</h3>
        <ol>
          <li>Intră în cabinetul furnizorului (ex. tvoetv.io) și deschide <b>„Плейлист / TVZone”</b>.</li>
          <li>Copiază <b>linkul playlistului M3U</b> (începe cu http:// sau https://).</li>
          <li>Lipește-l mai jos. Linkul rămâne doar pe server — nu apare în pagină și nu pleacă nicăieri altundeva.</li>
        </ol>
        <form id="tv-setup-form" class="ts-form">
          <input id="tv-url" type="url" required placeholder="https://…" autocomplete="off" spellcheck="false">
          <button class="btn" type="submit">Salvează</button>
        </form>
        <div class="ts-note" id="tv-note">${current ? `Acum: ${esc(current)}` : ""}</div>
        ${current ? `<button class="btn ghost small" id="tv-remove">Șterge playlistul</button> <a href="#/tv" class="btn ghost small">Înapoi la canale</a>` : ""}
      </div>
    </div>`;
  const note = $("#tv-note");
  $("#tv-setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    note.textContent = "Verific playlistul…";
    try {
      const r = await api("/api/iptv/playlist", { method: "PUT", body: JSON.stringify({ url: $("#tv-url").value.trim() }) });
      toast(`Playlist salvat: ${r.count} canale`);
      tvGroup = "all";
      loadTv();
    } catch (err) {
      note.textContent = err.message;
      btn.disabled = false;
    }
  });
  $("#tv-remove")?.addEventListener("click", async () => {
    if (!confirm("Ștergi playlistul IPTV de pe server?")) return;
    await api("/api/iptv/playlist", { method: "DELETE" }).catch(() => {});
    tvSetup();
  });
}

/* ---------- programul canalului (panou în dreapta; trecutul din arhivă se poate reda) ---------- */
async function tvGuide(ch, list) {
  document.querySelector(".tv-guide")?.remove();
  const panel = document.createElement("div");
  panel.className = "tv-guide";
  panel.innerHTML = `<div class="tv-guide-head"><b>${esc(ch.name)}</b><button class="tv-guide-x" title="Închide">${svg(I.close, 18)}</button></div>
    <div class="tv-guide-body"><div class="status">Se încarcă programul…</div></div>`;
  document.body.appendChild(panel);
  const close = () => panel.remove();
  panel.querySelector(".tv-guide-x").addEventListener("click", close);
  const onKey = (e) => e.key === "Escape" && (close(), document.removeEventListener("keydown", onKey));
  document.addEventListener("keydown", onKey);
  let g;
  try {
    g = await api(`/api/iptv/guide/${ch.id}`);
  } catch (err) {
    panel.querySelector(".tv-guide-body").innerHTML = `<div class="status error">${esc(err.message)}</div>`;
    return;
  }
  const body = panel.querySelector(".tv-guide-body");
  if (!g.programmes.length) {
    body.innerHTML = `<div class="status">Nu există program pentru canalul ăsta${g.archive_days ? "" : ""}.</div>`;
    return;
  }
  body.innerHTML = g.archive_days ? `<div class="ts-note">Arhivă ${g.archive_days} zile: emisiunile trecute cu ▶ pornesc de la început.</div>` : "";
  let day = null, liveRow = null;
  g.programmes.forEach((p) => {
    const d = tvDay(p.start);
    if (d !== day) {
      day = d;
      body.insertAdjacentHTML("beforeend", `<div class="tv-guide-day">${esc(d)}</div>`);
    }
    const row = document.createElement("div");
    row.className = "tv-guide-row" + (p.live ? " live" : p.archive ? " arch" : p.stop < Date.now() / 1000 ? " past" : "");
    row.innerHTML = `<span class="tv-guide-t">${tvHm(p.start)}</span><span class="tv-guide-title">${esc(p.title)}</span>
      ${p.live ? `<b class="tv-badge live">ACUM</b>` : p.archive ? `<b class="tv-badge arch">▶</b>` : ""}`;
    if (p.live || p.archive) {
      makeActivatable(row, () => {
        close();
        p.live ? playIptv(ch, list) : playIptv(ch, list, false, p.start);
      }, p.title);
    }
    if (p.live) liveRow = row;
    body.appendChild(row);
  });
  (liveRow || body.firstChild)?.scrollIntoView({ block: "center" });
}

/* ---------- player ---------- */
async function playIptv(ch, list, compat = false, at = null) {
  list = list && list.length ? list : (tvData ? tvData.channels : [ch]);
  enterCinema({ id: null, name: ch.name, type: "movie" });
  cinema.classList.add("cin-live");
  $("#cin-sub").textContent = at ? `TV · arhivă ${tvDay(at).toLowerCase()} ${tvHm(at)}` : `TV · ${ch.group || ""}`;
  const ps = beginPlay();
  const playerBox = $("#player");
  if (!playerBox) return;
  playerBox.innerHTML = compat
    ? `<div class="cin-status">Browserul nu poate decoda canalul așa cum vine — îl convertesc pe server…<small>încă 5–15 s</small></div>`
    : `<div class="cin-status">Pornesc canalul…<small>serverul se conectează la furnizor (3–10 s)</small></div>`;
  let sess;
  try {
    const qs = new URLSearchParams();
    if (compat) qs.set("compat", "1");
    if (at) qs.set("start", String(at));
    sess = await api(`/api/iptv/play/${ch.id}${qs.toString() ? `?${qs}` : ""}`, { method: "POST" });
  } catch (err) {
    if (ps !== playSeq) return;
    // HD întrețesut: serverul nu-l poate converti în timp real -> VLC pe calculator
    const hd = /"hd"\s*:\s*(\d+)/.exec(err.message);
    if (hd) tvReport(ch.id, false); // nici direct, nici convertit: la tine nu merge
    playerBox.innerHTML = hd
      ? `<div class="cin-status error">Browserul nu poate decoda video-ul acestui canal (${hd[1]}p întrețesut, ca la TV prin satelit), iar serverul nu-l poate converti în timp real.
          <small>Pornește accelerarea grafică în browser (edge://settings/system) sau deschide canalul în VLC.</small>
          <a class="btn live-open" href="/api/iptv/m3u/${ch.id}">${svg(I.play, 16)} Deschide în VLC</a></div>`
      : `<div class="cin-status error">${esc(err.message)}</div>`;
    return;
  }
  const stopSession = () => api(`/api/iptv/stop/${sess.session}`, { method: "POST", keepalive: true }).catch(() => {});
  if (ps !== playSeq) return stopSession();

  // așteptăm primele segmente; dacă ffmpeg cade (furnizorul refuză), spunem de ce
  const fail = (msg) => {
    if (ps === playSeq) playerBox.innerHTML = `<div class="cin-status error">${esc(msg)}</div>`;
    stopSession();
  };
  let ready = false;
  for (let i = 0; i < 30 && ps === playSeq; i++) {
    const r = await fetch(sess.playlist, { cache: "no-store" }).catch(() => null);
    if (r && r.ok && ((await r.text()).match(/#EXTINF/g) || []).length >= 2) {
      ready = true;
      break;
    }
    const st = await api(`/api/iptv/status/${sess.session}`).catch(() => ({ running: true }));
    if (!st.running) return fail(st.error || "Canalul nu pornește");
    await new Promise((res) => setTimeout(res, 1000));
  }
  if (ps !== playSeq) return stopSession();
  if (!ready) return fail("Canalul nu trimite date (furnizorul nu răspunde). Încearcă alt canal.");

  let Hls = null;
  try {
    Hls = await loadHls();
  } catch (_) {}
  if (ps !== playSeq) return stopSession();
  if (!Hls || !Hls.isSupported()) {
    Hls = null;
    if (!document.createElement("video").canPlayType("application/vnd.apple.mpegurl")) {
      return fail("Browserul nu poate reda HLS");
    }
  }

  const ctx = { alive: true };
  playerBox.innerHTML = playerHtml();
  playerBox.querySelector(".cin-video").classList.add("is-live");
  const video = playerBox.querySelector("#video");
  $("#buffer").classList.remove("hidden");
  $("#cin-mini").innerHTML = `<span class="dot-ok"></span>TV · ${esc(ch.name)}${at ? " · arhivă" : ""}${compat ? " · convertit pe server" : ""}
    <button class="tv-mini-guide" title="Programul canalului">${svg(TV_ICON_GUIDE, 14)} Program</button>`;
  $("#cin-mini .tv-mini-guide").addEventListener("click", () => tvGuide(ch, list));

  let hls = null;
  const statTimer = setInterval(async () => {
    const st = await api(`/api/iptv/status/${sess.session}`).catch(() => null);
    if (!ctx.alive || !st || st.running) return;
    const box = playerBox.querySelector("#video-error");
    if (box) {
      box.textContent = st.error || "Transmisia s-a oprit";
      box.classList.remove("hidden");
    }
  }, 5000);
  playerCleanup = () => {
    ctx.alive = false;
    clearInterval(statTimer);
    try {
      if (hls) hls.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch (_) {}
    stopSession();
  };

  if (Hls) {
    hls = new Hls({ liveSyncDurationCount: 3, maxBufferLength: 30, backBufferLength: 20, lowLatencyMode: false,
      manifestLoadingMaxRetry: 10, levelLoadingMaxRetry: 10, fragLoadingMaxRetry: 10 });
    hls.loadSource(sess.playlist);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    let mediaFails = 0;
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (!ctx.alive) return;
      // decodorul refuză video-ul (des: canale întrețesute de satelit) -> varianta convertită pe server
      if (compat && d.type === Hls.ErrorTypes.MEDIA_ERROR && video.error && /DECODE/i.test(video.error.message)) {
        tvReport(ch.id, false); // nici convertit nu merge
      }
      if (!compat && d.type === Hls.ErrorTypes.MEDIA_ERROR && video.error && /DECODE/i.test(video.error.message)) {
        console.warn("tv: decodare refuzată, trec la conversie pe server", video.error.message);
        return playIptv(ch, list, true, at);
      }
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && ++mediaFails <= 2) return hls.recoverMediaError();
      const box = playerBox.querySelector("#video-error");
      if (box) {
        box.textContent = d.type === Hls.ErrorTypes.MEDIA_ERROR
          ? "Browserul nu poate decoda video-ul acestui canal (ex. HEVC sau 1080i). Încearcă versiunea SD/HD a canalului."
          : "Transmisia nu răspunde. Încearcă din nou sau alt canal.";
        box.classList.remove("hidden");
      }
    });
  } else {
    video.src = sess.playlist; // Safari: HLS nativ
  }

  // a mers 8 s fără erori de decodare -> canalul merge în browserul tău (și dacă e 1080i: toate 1080i)
  let reported = false;
  video.addEventListener("timeupdate", () => {
    if (!reported && ctx.alive && video.currentTime > 8 && !video.error) {
      reported = true;
      tvReport(ch.id, true);
      ch.state = "ok";
    }
  });

  // canal anterior / următor din lista pe care o vedeai (butoanele ⏮ ⏭ și tastele lor)
  const i = list.findIndex((c) => c.id === ch.id);
  const nth = (k) => list[(i + k + list.length) % list.length];
  enhanceVideo(video, {
    ctx,
    prev: list.length > 1 ? () => playIptv(nth(-1), list) : null,
    next: list.length > 1 ? () => playIptv(nth(1), list) : null,
  });
}
