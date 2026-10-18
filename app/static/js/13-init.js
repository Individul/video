/* Cinema — pornirea aplicației.
   Scripturi clasice încărcate în ordine (index.html): împart același spațiu global. */
"use strict";

/* ================= init ================= */
(async () => {
  // login: Enter în câmp + click pe buton
  $("#login-btn").addEventListener("click", tryLogin);
  $("#login-pass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryLogin();
  });
  try {
    const items = await api("/api/watchlist");
    state.watchlist = new Set(items.map((i) => i.title.id));
    items.forEach((i) => (state.wlStatus[i.title.id] = i.status));
  } catch (_) {}
  try {
    state.history = await api("/api/history");
  } catch (_) {}
  render();
})();
