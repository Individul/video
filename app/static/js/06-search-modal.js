/* Cinema — căutare, API watchlist, modalul de detaliu.
   Scripturi clasice încărcate în ordine (index.html): împart același spațiu global. */
"use strict";

/* ================= SEARCH ================= */
$("#search-close").addEventListener("click", closeSearch);

function openSearch() {
  searchOverlay.classList.remove("hidden");
  $("#search-results").innerHTML = "";
  $("#search-input").value = "";
  $("#search-input").focus();
}
function closeSearch() {
  searchOverlay.classList.add("hidden");
}

$("#search-input").addEventListener(
  "input",
  debounce(async (e) => {
    const q = e.target.value.trim();
    const box = $("#search-results");
    const current = () => $("#search-input").value.trim() === q; // răspuns pentru textul actual?
    if (q.length < 2) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = `<div class="status">Se caută...</div>`;
    try {
      const { results, errors } = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (!current()) return; // „matri” sosit după „matrix” — ignorat
      box.innerHTML = "";
      if (!results.length) {
        box.innerHTML = `<div class="status">${errors.length ? esc(errors[0]) : "Niciun rezultat."}</div>`;
        return;
      }
      results.forEach((t) => box.appendChild(cardEl(t)));
    } catch (err) {
      if (current()) box.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
    }
  }, 350)
);

$("#search-input").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const q = e.target.value.trim();
  if (q.length < 2) return;
  closeSearch();
  go(`#/search/${encodeURIComponent(q)}`);
});

async function loadSearchPage(q) {
  const seq = viewSeq;
  content.innerHTML = `<div class="grid-wrap"><div class="view-title">Rezultate pentru „${esc(q)}"</div>${skelGrid(8)}</div>`;
  try {
    const { results, errors } = await api(`/api/search?q=${encodeURIComponent(q)}`);
    if (seq !== viewSeq) return;
    content.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "grid-wrap";
    wrap.innerHTML = `<div class="view-title">Rezultate pentru „${esc(q)}" (${results.length})</div>`;
    if (!results.length) {
      wrap.innerHTML += `<div class="status">${errors.length ? esc(errors[0]) : "Niciun rezultat."}</div>`;
    } else {
      const grid = document.createElement("div");
      grid.className = "grid";
      results.forEach((t) => grid.appendChild(cardEl(t)));
      wrap.appendChild(grid);
    }
    content.appendChild(wrap);
  } catch (err) {
    if (seq === viewSeq) content.innerHTML = `<div class="status error">Eroare: ${esc(err.message)}</div>`;
  }
}

/* ================= WATCHLIST API ================= */
async function toggleWatchlist(title) {
  if (state.watchlist.has(title.id)) {
    await api(`/api/watchlist/${title.id}`, { method: "DELETE" });
    state.watchlist.delete(title.id);
    delete state.wlStatus[title.id];
    toast("Scos din watchlist");
  } else {
    await api("/api/watchlist", {
      method: "POST",
      body: JSON.stringify({ title_id: title.id }),
    });
    state.watchlist.add(title.id);
    state.wlStatus[title.id] = "to_watch";
    toast(`Adaugat în watchlist: ${title.name}`);
  }
  return state.watchlist.has(title.id);
}

/* ================= MODAL detaliu ================= */
const modal = $("#modal");
const modalBody = $("#modal-body");

$("#modal-close").addEventListener("click", leaveDetail);
modal.addEventListener("click", (e) => {
  if (e.target === modal) leaveDetail();
});

/* gradient jos cât timp mai există conținut sub marginea vizibilă */
function updateModalFade() {
  const fade = $("#modal-fade");
  if (!fade || modal.classList.contains("hidden")) return;
  const more = modal.scrollHeight - modal.scrollTop - modal.clientHeight > 60;
  fade.classList.toggle("hidden", !more);
}
modal.addEventListener("scroll", updateModalFade, { passive: true });
window.addEventListener("resize", updateModalFade);

/* ---------- ciclul de viață al modalului și al player-ului ----------
   detailSeq: crește la fiecare deschidere/închidere — un /api/title întârziat nu mai
              redeschide nimic după Escape sau după ce ai ales alt titlu.
   playSeq:   crește la fiecare pornire de redare/închidere — clicurile rapide pe
              versiuni/episoade nu se mai suprascriu între ele.
   playerCleanup: oprește player-ul curent (progres final, cronometre, stream). */
let detailSeq = 0;
let playSeq = 0;
let playerCleanup = null;
let lastFocus = null;

/* torrentele care nu se mai redau sunt deconectate în TorrServer după câteva secunde
   (altfel continuă să descarce și iau banda filmului curent). Întârzierea evită
   deconectarea când doar schimbi fișierul în același torrent. */
const pendingDrops = new Map(); // hash -> timeout
function scheduleDrop(hash, delay = 5000) {
  if (!hash) return;
  clearTimeout(pendingDrops.get(hash));
  pendingDrops.set(
    hash,
    setTimeout(() => {
      pendingDrops.delete(hash);
      api("/api/torrents/drop", { method: "POST", keepalive: true, body: JSON.stringify({ hash }) }).catch(() => {});
    }, delay)
  );
}
function keepTorrent(hash) {
  if (pendingDrops.has(hash)) {
    clearTimeout(pendingDrops.get(hash));
    pendingDrops.delete(hash);
  }
}

function stopPlayer() {
  playSeq++;
  if (playerCleanup) {
    const fn = playerCleanup;
    playerCleanup = null;
    fn();
  }
}
/* pornește o redare nouă: oprește ce rula și întoarce tokenul ei */
function beginPlay() {
  stopPlayer();
  return playSeq;
}
