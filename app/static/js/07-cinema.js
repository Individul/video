/* Cinema — modul cinema și starea torrentului.
   Scripturi clasice încărcate în ordine (index.html): împart același spațiu global. */
"use strict";

/* ================= MODUL CINEMA =================
   La redare, player-ul (#player), lista de versiuni (#torrents) și episoadele (#tab-eps)
   se mută din pagina filmului într-un strat pe toată fereastra; la închidere revin la loc
   (un comentariu-marcaj le ține locul). Mutarea păstrează toți listenerii. */
const cinema = $("#cinema");
const cinemaSlots = {}; // id -> { ph: marcajul din pagină, wasHidden }

function moveIntoCinema(id, target) {
  const el = document.getElementById(id);
  if (!el || cinemaSlots[id]) return;
  const ph = document.createComment(`loc:${id}`);
  el.before(ph);
  cinemaSlots[id] = { ph, wasHidden: el.classList.contains("hidden") };
  el.classList.remove("hidden");
  target.appendChild(el);
}
function restoreFromCinema(id) {
  const slot = cinemaSlots[id];
  if (!slot) return;
  delete cinemaSlots[id];
  const el = document.getElementById(id);
  if (el && slot.ph.isConnected) {
    slot.ph.replaceWith(el);
    el.classList.toggle("hidden", slot.wasHidden);
  } else {
    el?.remove(); // pagina filmului s-a schimbat între timp
    slot.ph.remove();
  }
}
const cinemaOpen = () => !cinema.classList.contains("hidden");

function enterCinema(t) {
  cinema.classList.remove("cin-live");
  $("#cin-title").textContent = t.name;
  $("#cin-sub").textContent = "";
  $("#cin-mini").textContent = "";
  $("#cin-tab-eps").classList.toggle("hidden", t.type !== "series");
  if (cinemaOpen()) return;
  if (!document.getElementById("player")) {
    // pagini fără player propriu (ex. „Torrente”): modul cinema își creează unul temporar
    const p = document.createElement("div");
    p.id = "player";
    p.className = "player-box";
    p.dataset.temp = "1";
    $("#cin-stage").appendChild(p);
  }
  moveIntoCinema("player", $("#cin-stage"));
  moveIntoCinema("torrents", $("#cin-pane-versions"));
  if (t.type === "series") moveIntoCinema("tab-eps", $("#cin-pane-eps"));
  cinema.classList.remove("hidden");
  document.body.classList.add("cinema-open");
  wakeCinemaUi();
}

function exitCinema() {
  if (!cinemaOpen()) return;
  stopPlayer();
  stopStatsPoll();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const p = $("#player");
  if (p && p.dataset.temp) p.remove(); // creat doar pentru modul cinema — nu rămâne dublură
  else if (p) p.innerHTML = "";
  $("#cin-files").innerHTML = "";
  ["player", "torrents", "tab-eps"].forEach(restoreFromCinema);
  setCinemaPanel(null);
  cinema.classList.add("hidden");
  cinema.classList.remove("idle");
  document.body.classList.remove("cinema-open");
}

/* panoul lateral: versiuni / episoade / stare (al doilea clic pe același buton îl închide) */
function setCinemaPanel(name) {
  const panel = $("#cin-panel");
  if (!name || (panel.dataset.pane === name && !panel.classList.contains("hidden"))) {
    panel.classList.add("hidden");
    panel.dataset.pane = "";
    name = null;
  } else {
    panel.classList.remove("hidden");
    panel.dataset.pane = name;
    ["versions", "eps", "stats"].forEach((n) => $(`#cin-pane-${n}`).classList.toggle("hidden", n !== name));
    if (name === "stats") refreshStats();
  }
  document.querySelectorAll(".cin-tab").forEach((b) => b.classList.toggle("on", b.dataset.pane === name));
}
document.querySelectorAll(".cin-tab").forEach((b) => b.addEventListener("click", () => setCinemaPanel(b.dataset.pane)));
$("#cin-close").addEventListener("click", exitCinema);

/* comenzile dispar după 3 s fără mișcare cât timp filmul rulează (ca la cinema) */
let cinemaIdleTimer = null;
function wakeCinemaUi() {
  cinema.classList.remove("idle");
  clearTimeout(cinemaIdleTimer);
  cinemaIdleTimer = setTimeout(() => {
    const v = $("#video");
    const popOpen = cinema.querySelector(".cin-pop:not(.hidden)");
    if (v && !v.paused && !popOpen && cinemaOpen()) cinema.classList.add("idle");
  }, 3000);
}
["mousemove", "pointerdown", "keydown"].forEach((ev) => cinema.addEventListener(ev, wakeCinemaUi, { passive: true }));

/* ---------- starea torrentului (bara de sus + panoul „Stare”) ---------- */
let statsTimer = null;
let currentStream = null; // { hash, size, name, quality }
const fmtMbit = (bps) => (bps / 1e6).toFixed(bps >= 1e7 ? 0 : 1);
const fmtMB = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : Math.round(b / 1e6) + " MB");

function startStatsPoll(info) {
  currentStream = info;
  stopStatsPoll();
  refreshStats();
  statsTimer = setInterval(refreshStats, 3000);
}
function stopStatsPoll() {
  clearInterval(statsTimer);
  statsTimer = null;
}
async function refreshStats() {
  const cur = currentStream;
  if (!cur || !cinemaOpen()) return;
  let s;
  try {
    s = await api(`/api/torrents/stats/${cur.hash}`);
  } catch (_) {
    return;
  }
  if (cur !== currentStream) return;
  const video = $("#video");
  const dur = video && Number.isFinite(video.duration) ? video.duration : 0;
  const bitrate = dur && cur.size ? (cur.size * 8) / dur : 0; // debitul mediu al filmului
  const cacheFull = s.cache_capacity && s.cache_filled >= s.cache_capacity * 0.85; // TorrServer a umplut cache-ul: e înainte
  const ahead = bitrate ? Math.round((s.preloaded * 8) / bitrate) : 0; // secunde încărcate înainte
  let verdict, cls;
  if (cacheFull || (bitrate && s.download_bps >= bitrate * 1.3)) {
    verdict = "Torrentul ține pasul cu filmul.";
    cls = "ok";
  } else if (bitrate && s.download_bps < bitrate && s.preloaded < (s.cache_capacity || 1) * 0.3) {
    verdict = "Torrentul descarcă mai încet decât debitul filmului — poate apărea buffering. Alege o versiune cu mai mulți seederi sau 1080p în loc de 4K.";
    cls = "bad";
  } else {
    verdict = "Se încarcă — viteza ar trebui să ajungă.";
    cls = "mid";
  }
  $("#cin-mini").innerHTML = `<span class="dot-${cls}"></span>↓ ${fmtMbit(s.download_bps)} Mbit/s · ${s.peers_active} peers${ahead ? ` · ${ahead}s în avans` : ""}`;
  if ($("#cin-panel").dataset.pane === "stats") {
    $("#cin-pane-stats").innerHTML = `
      <div class="cin-verdict ${cls}">${esc(verdict)}</div>
      <dl class="facts cin-facts">
        <dt>Viteză descărcare</dt><dd>${fmtMbit(s.download_bps)} Mbit/s</dd>
        <dt>Debitul filmului</dt><dd>${bitrate ? `~${fmtMbit(bitrate)} Mbit/s` : "—"}</dd>
        <dt>Încărcat în avans</dt><dd>${fmtMB(s.preloaded)}${s.cache_capacity ? ` (cache ${fmtMB(s.cache_filled)} din ${fmtMB(s.cache_capacity)})` : ""}${ahead ? ` (~${ahead} s de film)` : ""}</dd>
        <dt>Peers activi</dt><dd>${s.peers_active} din ${s.peers_total} (seederi ${s.seeders})</dd>
        <dt>Upload</dt><dd>${fmtMbit(s.upload_bps)} Mbit/s</dd>
        <dt>Citit până acum</dt><dd>${fmtMB(s.read)}</dd>
        <dt>Mărime fișier</dt><dd>${cur.size ? fmtMB(cur.size) : "—"}</dd>
        <dt>Fișier</dt><dd class="wrap">${esc(cur.name || "")}</dd>
      </dl>
      <div class="cin-hint">Când cache-ul e plin, viteza scade la 0 — e normal: TorrServer așteaptă să consumi din ce a încărcat.</div>`;
  }
}

function closeDetail() {
  exitCinema();
  const wasOpen = !modal.classList.contains("hidden");
  detailSeq++;
  stopPlayer();
  modal.classList.add("hidden");
  modalBody.innerHTML = "";
  document.removeEventListener("keydown", playerKeysHandler);
  if (wasOpen && lastFocus && document.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
  document.title = "Cinema";
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (document.fullscreenElement) return; // Escape iese întâi din fullscreen
    if (cinemaOpen()) return exitCinema();
    if (!searchOverlay.classList.contains("hidden")) return closeSearch();
    if (!modal.classList.contains("hidden")) leaveDetail();
  }
});
// telefon: aplicația trimisă în fundal / tab închis -> salvăm poziția
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && currentProgressSave) currentProgressSave();
});
window.addEventListener("pagehide", () => {
  if (currentProgressSave) currentProgressSave();
  stopPlayer(); // anulează extragerea subtitrărilor
  // tab închis/reîncărcat: torrentul se deconectează imediat, nu peste 5s (pagina nu mai există)
  for (const [hash, timer] of pendingDrops) {
    clearTimeout(timer);
    pendingDrops.delete(hash);
    api("/api/torrents/drop", { method: "POST", keepalive: true, body: JSON.stringify({ hash }) }).catch(() => {});
  }
});
