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
  const wrap = document.createElement("div");
  wrap.className = "grid-wrap tv-page";
  wrap.innerHTML = `
    <div class="tv-head">
      <div class="view-title">TV</div>
      <span class="tv-sub">${data.channels.length} canale · ${esc(data.source)}</span>
      <div class="tv-actions">
        <button class="btn ghost small" id="tv-refresh" title="Descarcă din nou playlistul">${svg(I.resync, 15)} Actualizează</button>
        <button class="btn ghost small" id="tv-change">Schimbă playlistul</button>
      </div>
    </div>
    <form class="ts-form" id="tv-form">${svg(BK_SEARCH_ICON, 20)}
      <input id="tv-q" type="search" placeholder="Caută canal (ex. Матч, Discovery, Кино)…" autocomplete="off">
    </form>
    <div class="q-filter tv-groups" id="tv-groups"></div>
    <div class="tv-grid" id="tv-grid"></div>`;
  content.innerHTML = "";
  content.appendChild(wrap);
  $("#tv-refresh").addEventListener("click", () => loadTv({ refresh: true }));
  $("#tv-change").addEventListener("click", () => tvSetup(data.source));
  $("#tv-form").addEventListener("submit", (e) => e.preventDefault());

  const input = $("#tv-q"), groupsBox = $("#tv-groups"), grid = $("#tv-grid");
  const groups = [["fav", `★ Favorite ${fav.size}`], ["all", `Toate ${data.channels.length}`],
    ...data.groups.map((g) => [g.name, `${g.name} ${g.count}`])];
  if (!groups.some(([k]) => k === tvGroup) || (tvGroup === "fav" && !fav.size)) tvGroup = fav.size ? "fav" : "all";
  const drawGroups = () => {
    groupsBox.innerHTML = groups
      .filter(([k]) => k !== "fav" || fav.size)
      .map(([k, l]) => `<button data-g="${esc(k)}" class="${k === tvGroup ? "on" : ""}">${esc(k === "fav" ? `★ Favorite ${fav.size}` : l)}</button>`)
      .join("");
  };
  const shown = () => {
    const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return data.channels.filter((c) =>
      (words.length ? true : tvGroup === "all" || (tvGroup === "fav" ? fav.has(c.id) : c.group === tvGroup)) &&
      words.every((w) => c.name.toLowerCase().includes(w)));
  };
  const draw = () => {
    const list = shown();
    grid.innerHTML = list.length ? "" : `<div class="status">Niciun canal${input.value ? ` pentru „${esc(input.value)}”` : " aici"}.</div>`;
    const frag = document.createDocumentFragment();
    list.slice(0, 600).forEach((c) => {
      const tile = document.createElement("div");
      tile.className = "tv-tile";
      tile.innerHTML = `
        <div class="tv-logo">${c.logo ? `<img loading="lazy" alt="" src="${escUrl(c.logo)}">` : ""}<span>${esc(c.name.slice(0, 2))}</span></div>
        <div class="tv-name">${esc(c.name)}</div>
        ${c.catchup_days ? `<div class="tv-arch" title="Arhivă ${c.catchup_days} zile la furnizor">${c.catchup_days}z</div>` : ""}
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
      makeActivatable(tile, () => playIptv(c, list), c.name);
      frag.appendChild(tile);
    });
    grid.appendChild(frag);
    if (list.length > 600) grid.insertAdjacentHTML("beforeend", `<div class="status">… încă ${list.length - 600} canale — caută după nume.</div>`);
  };
  groupsBox.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    tvGroup = b.dataset.g;
    try {
      localStorage.setItem("tv-group", tvGroup);
    } catch (_) {}
    input.value = "";
    drawGroups();
    draw();
  });
  input.addEventListener("input", draw);
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

/* ---------- player ---------- */
async function playIptv(ch, list, compat = false) {
  list = list && list.length ? list : (tvData ? tvData.channels : [ch]);
  enterCinema({ id: null, name: ch.name, type: "movie" });
  cinema.classList.add("cin-live");
  $("#cin-sub").textContent = `TV · ${ch.group || ""}`;
  const ps = beginPlay();
  const playerBox = $("#player");
  if (!playerBox) return;
  playerBox.innerHTML = compat
    ? `<div class="cin-status">Browserul nu poate decoda canalul așa cum vine — îl convertesc pe server…<small>încă 5–15 s</small></div>`
    : `<div class="cin-status">Pornesc canalul…<small>serverul se conectează la furnizor (3–10 s)</small></div>`;
  let sess;
  try {
    sess = await api(`/api/iptv/play/${ch.id}${compat ? "?compat=1" : ""}`, { method: "POST" });
  } catch (err) {
    if (ps !== playSeq) return;
    // HD întrețesut: serverul nu-l poate converti în timp real -> VLC pe calculator
    const hd = /"hd"\s*:\s*(\d+)/.exec(err.message);
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
  $("#cin-mini").innerHTML = `<span class="dot-ok"></span>TV · ${esc(ch.name)}${compat ? " · convertit pe server" : ""}`;

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
      if (!compat && d.type === Hls.ErrorTypes.MEDIA_ERROR && video.error && /DECODE/i.test(video.error.message)) {
        console.warn("tv: decodare refuzată, trec la conversie pe server", video.error.message);
        return playIptv(ch, list, true);
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

  // canal anterior / următor din lista pe care o vedeai (butoanele ⏮ ⏭ și tastele lor)
  const i = list.findIndex((c) => c.id === ch.id);
  const at = (k) => list[(i + k + list.length) % list.length];
  enhanceVideo(video, {
    ctx,
    prev: list.length > 1 ? () => playIptv(at(-1), list) : null,
    next: list.length > 1 ? () => playIptv(at(1), list) : null,
  });
}
