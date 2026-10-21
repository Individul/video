/* Cinema — clopoțelul: episoade noi (deja pe trackere) și sezoane anunțate la serialele urmărite
   (Watchlist + cele pornite). Serverul verifică singur la 4 ore. */
"use strict";

const nfAgo = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `acum ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `acum ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d === 1 ? "ieri" : `acum ${d} zile`;
};

function nfBadge(n) {
  const b = document.querySelector('.nav-item[data-view="news"] .nav-badge');
  if (!b) return;
  b.textContent = n > 9 ? "9+" : String(n);
  b.hidden = !n;
}

async function nfRefreshBadge() {
  // fetch direct, nu api(): fără sesiune (401) nu deschidem noi fereastra de login
  try {
    const r = await fetch("/api/notifications");
    if (r.ok) nfBadge((await r.json()).unread);
  } catch (_) {}
}

async function loadNews() {
  const seq = viewSeq;
  content.innerHTML = `<div class="grid-wrap nf-page"><div class="view-title">Noutăți</div><div class="status">Se încarcă…</div></div>`;
  let data;
  try {
    data = await api("/api/notifications");
  } catch (err) {
    if (seq === viewSeq) content.innerHTML = `<div class="grid-wrap"><div class="status error">${esc(err.message)}</div></div>`;
    return;
  }
  if (seq !== viewSeq) return;
  const wrap = document.createElement("div");
  wrap.className = "grid-wrap nf-page";
  const last = data.check && data.check.last ? `Ultima verificare: ${nfAgo(new Date(data.check.last * 1000).toISOString())}` : "Verificarea pornește la câteva minute după pornirea serverului";
  wrap.innerHTML = `
    <div class="nf-head">
      <div class="view-title">Noutăți</div>
      <span class="tv-sub">${esc(last)} · apoi la fiecare 4 ore</span>
      <button class="btn ghost small" id="nf-check">${svg(I.resync, 15)} Verifică acum</button>
    </div>
    <div class="cal-hint">Episoadele noi apar aici când sunt deja pe trackere (le poți porni imediat), plus sezoanele noi anunțate — pentru serialele din Watchlist și cele pe care le-ai început.</div>
    <div class="nf-list"></div>`;
  content.innerHTML = "";
  content.appendChild(wrap);
  const list = wrap.querySelector(".nf-list");
  if (!data.items.length) list.innerHTML = `<div class="status">Nimic nou deocamdată.</div>`;
  data.items.forEach((n) => {
    const t = n.title;
    const row = document.createElement("div");
    row.className = "nf-row" + (n.read ? "" : " unread") + (n.kind === "season" ? " season" : "");
    row.innerHTML = `
      <div class="nf-poster">${t.poster ? `<img alt="" loading="lazy" src="${escUrl(t.poster)}">` : ""}</div>
      <div class="nf-main">
        <div class="nf-title">${esc(t.name)}</div>
        <div class="nf-text">${n.kind === "episode" ? svg(I.play, 13) : "📅"} ${esc(n.text)}</div>
      </div>
      <div class="nf-when">${esc(nfAgo(n.created_at))}</div>`;
    makeActivatable(row, () => go(`#/title/${t.id}`), t.name);
    list.appendChild(row);
  });
  if (data.unread) {
    api("/api/notifications/read", { method: "POST" }).catch(() => {});
    nfBadge(0);
  }
  $("#nf-check").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.innerHTML = `${svg(I.resync, 15)} Verific…`;
    try {
      const r = await api("/api/notifications/check", { method: "POST" });
      toast(r.created ? `${r.created} noutăți noi` : "Nimic nou");
    } catch (err) {
      toast(err.message, false);
    }
    loadNews();
  });
}

// numărul de pe clopoțel: la pornire și apoi la 10 minute
nfRefreshBadge();
setInterval(nfRefreshBadge, 600000);
