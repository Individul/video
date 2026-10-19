/* Cinema — căutare, API watchlist, modalul de detaliu.
   Scripturi clasice încărcate în ordine (index.html): împart același spațiu global. */
"use strict";

/* ================= SEARCH ================= */
$("#search-close").addEventListener("click", closeSearch);

/* căutări recente (în browser) + „Populare acum” — ce vezi până scrii ceva */
const RECENT_KEY = "cinema-recent-searches";
function loadRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
  } catch (_) {
    return [];
  }
}
function rememberSearch(q) {
  q = (q || "").trim();
  if (q.length < 2) return;
  const list = [q, ...loadRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch (_) {}
}
let searchTrending = null; // o singură cerere per sesiune
async function renderSearchEmpty() {
  const box = $("#search-empty");
  box.classList.remove("hidden");
  const recent = loadRecent();
  box.innerHTML = `
    ${recent.length ? `<div class="se-head">Căutări recente <button class="se-clear" type="button">Șterge</button></div>
      <div class="se-chips">${recent.map((q) => `<button type="button" data-q="${esc(q)}">${svg(I.history || "M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 2 5l-1.4 1.4A9 9 0 1 0 13 3z", 15)}${esc(q)}</button>`).join("")}</div>` : ""}
    <div class="se-head">Populare acum</div>
    <div class="search-results" id="se-trending"><div class="status">Se încarcă…</div></div>`;
  box.querySelectorAll(".se-chips button").forEach((b) =>
    b.addEventListener("click", () => {
      const inp = $("#search-input");
      inp.value = b.dataset.q;
      inp.dispatchEvent(new Event("input"));
      inp.focus();
    })
  );
  box.querySelector(".se-clear")?.addEventListener("click", () => {
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch (_) {}
    renderSearchEmpty();
  });
  try {
    searchTrending = searchTrending || (await api("/api/browse?category=trending_day")).results || [];
  } catch (_) {
    searchTrending = searchTrending || [];
  }
  const grid = box.querySelector("#se-trending");
  if (!grid) return;
  grid.innerHTML = "";
  searchTrending.slice(0, 12).forEach((t) => grid.appendChild(cardEl(t)));
}

let navBeforeSearch = null;
function openSearch() {
  navBeforeSearch = document.querySelector(".nav-item.active")?.dataset.view || null;
  setNavActive("search");
  searchOverlay.classList.remove("hidden");
  $("#search-results").innerHTML = "";
  $("#search-input").value = "";
  $("#search-input").focus();
  renderSearchEmpty();
}
function closeSearch() {
  if (!searchOverlay.classList.contains("hidden") && navBeforeSearch) setNavActive(navBeforeSearch);
  searchOverlay.classList.add("hidden");
}
// ai deschis un rezultat: căutarea intră la „recente”
$("#search-results").addEventListener("click", () => rememberSearch($("#search-input").value), true);

$("#search-input").addEventListener(
  "input",
  debounce(async (e) => {
    const q = e.target.value.trim();
    const box = $("#search-results");
    const current = () => $("#search-input").value.trim() === q; // răspuns pentru textul actual?
    if (q.length < 2) {
      box.innerHTML = "";
      renderSearchEmpty();
      return;
    }
    $("#search-empty").classList.add("hidden");
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
  rememberSearch(q);
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
