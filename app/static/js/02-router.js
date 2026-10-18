/* Cinema — routing după hash (#/title/…, #/browse/…).
   Scripturi clasice încărcate în ordine (index.html): împart același spațiu global. */
"use strict";

/* ================= routing (hash) ================= */
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  const seg = h.split("/").filter(Boolean);
  if (!seg.length) return { view: "home" };
  if (seg[0] === "browse") return { view: "browse", category: CATEGORIES[seg[1]] ? seg[1] : "films" };
  if (seg[0] === "title" && /^\d+$/.test(seg[1] || "")) return { view: "title", id: +seg[1] };
  if (seg[0] === "person" && /^\d+$/.test(seg[1] || "")) return { view: "person", id: +seg[1] };
  if (seg[0] === "search") {
    let q = seg.slice(1).join("/");
    try {
      q = decodeURIComponent(q);
    } catch (_) {} // hash scris de mână cu „%” invalid — folosim textul brut
    return { view: "searchpage", q };
  }
  if (seg[0] === "watchlist") return { view: "watchlist" };
  if (seg[0] === "continue") return { view: "continue" };
  if (seg[0] === "downloads") return { view: "downloads" };
  if (seg[0] === "calendar") return { view: "calendar" };
  if (seg[0] === "sport") return { view: "sport" };
  if (seg[0] === "live") return { view: "live" };
  if (seg[0] === "torrents") {
    let q = seg.slice(1).join("/");
    try {
      q = decodeURIComponent(q);
    } catch (_) {}
    return { view: "torrents", q };
  }
  return { view: "home" };
}
function go(hash) {
  if (location.hash === hash) {
    forceRender = true; // clic pe pagina curentă din meniu = reîncărcare
    render();
  }
  else location.hash = hash;
}

/* categoriile din meniu: discover cu filtre; listele (trend etc.) nu au filtre */
const CATEGORIES = {
  films: { title: "Filme", filters: true },
  series: { title: "Seriale", filters: true },
  cartoons: { title: "Desene animate", filters: true },
  anime: { title: "Anime", filters: true },
  now_playing: { title: "Acum în cinematografe", filters: false },
  trending_day: { title: "În trend azi", filters: false },
  trending_week: { title: "În trend săptămâna aceasta", filters: false },
};
window.addEventListener("hashchange", render);

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    const v = btn.dataset.view;
    if (v === "search") {
      openSearch();
      return;
    }
    go(v === "home" ? "#/" : CATEGORIES[v] ? `#/browse/${v}` : `#/${v}`);
  });
});

function setNavActive(view) {
  document.querySelectorAll(".nav-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view)
  );
}

/* fiecare navigare primește un număr; un loader care termină după ce ai plecat
   în altă pagină vede că numărul s-a schimbat și nu mai desenează nimic */
let viewSeq = 0;

/* pagina filmului are adresă proprie (#/title/123): butonul Înapoi al browserului merge,
   iar linkul se poate trimite. Pagina de dedesubt (pageHash) rămâne încărcată, cu scroll-ul ei.
   detailDepth = câte pagini de film am deschis noi la rând (titlu -> similar -> ...),
   ca „Închide” să revină direct la pagina de dedesubt. */
let pageHash = null;
let detailDepth = 0;
let navFromApp = false;
let forceRender = false;

function openDetail(title) {
  const hash = `#/title/${title.id}`;
  if (location.hash === hash) return; // deja deschis
  navFromApp = true;
  location.hash = hash;
}
/* butonul ✕ / Escape / clic în afară */
function leaveDetail() {
  if (detailDepth > 0) {
    const n = detailDepth;
    detailDepth = 0;
    history.go(-n);
  } else {
    location.hash = pageHash || "#/";
  }
}

async function render() {
  const r = parseRoute();
  closeSearch();

  if (r.view === "title") {
    // după Înapoi/Înainte din browser nu mai știm sigur câte filme sunt deasupra paginii
    // de dedesubt (-1): „Închide” sare atunci direct la ea, în loc de history.go(-n)
    if (navFromApp) detailDepth = detailDepth >= 0 ? detailDepth + 1 : -1;
    else detailDepth = -1;
    navFromApp = false;
    forceRender = false;
    if (pageHash === null) {
      // link direct spre un film: încărcăm acasă dedesubt
      pageHash = "#/";
      viewSeq++;
      setNavActive("home");
      loadHome();
    }
    showDetail(r.id);
    return;
  }

  navFromApp = false;
  detailDepth = 0;
  closeDetail();
  const hash = location.hash || "#/";
  // înapoi din pagina filmului: pagina de dedesubt e deja încărcată — o păstrăm, cu scroll
  if (hash === pageHash && content.childElementCount && !forceRender) return;
  forceRender = false;
  pageHash = hash;

  viewSeq++;
  const navView = r.view === "browse" ? r.category : r.view === "searchpage" || r.view === "person" ? null : r.view;
  setNavActive(navView);
  window.scrollTo(0, 0);

  if (r.view === "home") return loadHome();
  if (r.view === "person") return loadPerson(r.id);
  if (r.view === "browse") return loadBrowse(r.category);
  if (r.view === "searchpage") return loadSearchPage(r.q);
  if (r.view === "watchlist") return loadWatchlist();
  if (r.view === "continue") return loadContinue();
  if (r.view === "downloads") return loadDownloads();
  if (r.view === "calendar") return loadCalendar();
  if (r.view === "sport") return loadSport();
  if (r.view === "live") return loadLive();
  if (r.view === "torrents") return loadTorrentSearch(r.q);
  return loadHome();
}
