# vid pe Vercel (fără server propriu)

Portalul rulează ca funcție serverless + static hosting, cu **TorrServer la distanță**.
Gratuit pe planul Hobby.

## Cum se publică

1. **Repo**: codul e pe GitHub (acest repo). Modificările statice: ține `public/` în sincron
   cu `app/static/` (sunt copii — `cp app/static/index.html public/` etc.).
2. **Vercel**: [vercel.com](https://vercel.com) → Add New → Project → Import repo-ul →
   la Environment Variables adaugi:

   | Variabilă | Obligatoriu | Exemplu |
   |---|---|---|
   | `TMDB_API_KEY` | da | cheia ta TMDB |
   | `TORRSERVER_URL` | da | `http://adresa:port` al TorrServer-ului tău |
   | `TORRSERVER_AUTH` | dacă are parolă | `user:parola` |
   | `APP_PASSWORD` | recomandat | parola portalului |
   | `APP_SECRET` | cu parolă | șir aleator lung |
   | `PROXY` | dacă Rutor e blocat | `http://user:pass@proxy:port` |
   | `DB_URL` | opțional | `postgresql+asyncpg://...` (Supabase free) |

3. Deploy. Gata: `https://proiect.vercel.app`.

## Ce se schimbă față de local/VPS

- **DB**: fără `DB_URL`, watchlist/istoricul trăiesc într-un SQLite efemer (`/tmp`) —
  se resetează periodic (la cold start). Pentru persistență reală: cont gratuit
  [Supabase](https://supabase.com) → Settings → Database → Connection string (URI) →
  pune la `DB_URL` înlocuind `postgresql://` cu `postgresql+asyncpg://`.
- **Subtitrări din MKV** (extragerea ffmpeg) nu merg pe serverless — dispar grațios;
  rămân subtitrările .srt din torrent și cele externe (OS_API_KEY).
- **Căutarea de magneți** de pe IP-urile Vercel (AWS): Rutor/BTDig pot răspunde cu
  blocare — atunci setează `PROXY`. Jackett (dacă ai Torznab) merge de oriunde.
- **Redarea** nu trece prin Vercel: browserul trage video direct din TorrServer-ul tău.

## Update

```bash
# din folderul proiectului (local)
cp app/static/index.html public/index.html
cp app/static/app.js public/static/app.js
cp app/static/style.css public/static/style.css
git add -A && git commit -m "update" && git push
# Vercel redeploy-ează automat la push
```
