import os
import shutil
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Vercel/serverless: fără disk persistent și fără ffmpeg
SERVERLESS = os.getenv("VERCEL") == "1"

# directorul de date (DB, subs, cookies) — pe VPS/Docker se punctează la volumul persisten
ROOT = Path(os.getenv("VID_DATA_DIR", "/tmp/vid-data" if SERVERLESS else str(Path(__file__).resolve().parent.parent)))
ROOT.mkdir(parents=True, exist_ok=True)


class Config:
    """Setari aplicatie — se pot suprascrie prin variabile de mediu / .env"""

    SERVERLESS = SERVERLESS  # Vercel: fără disk persistent / ffmpeg

    DB_URL = os.getenv("DB_URL", f"sqlite+aiosqlite:///{ROOT / 'vid.db'}")

    USER_AGENT = os.getenv(
        "USER_AGENT",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    )

    # Sursa principala de catalog — TMDB (cheie API gratuita de la themoviedb.org)
    TMDB_API_KEY = os.getenv("TMDB_API_KEY") or None
    TMDB_LANG = os.getenv("TMDB_LANG", "ru-RU")
    TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500"
    TMDB_BASE = "https://api.themoviedb.org/3"

    # Redare prin TorrServer: local (implicit) sau la distanță (implicit la distr, cu parolă)
    TORRSERVER_URL = os.getenv("TORRSERVER_URL", "http://127.0.0.1:8090").rstrip("/")
    # autentificare TorrServer, format "utilizator:parola" (Basic auth;utilizator poate fi orice)
    TORRSERVER_AUTH = os.getenv("TORRSERVER_AUTH") or None
    # VPS: browserul primește stream-urile pe această cale a portalului (ex. /ts), pe care
    # Caddy o trimite la TorrServer-ul intern; gol = browserul accesează TorrServer direct (local)
    STREAM_PROXY_PATH = (os.getenv("STREAM_PROXY_PATH") or "").rstrip("/") or None

    # Cautarea magneților pe Rutor (mirror-uri în ordinea de fallback)
    RUTOR_MIRRORS: list[str] = [
        m.strip()
        for m in os.getenv("RUTOR_MIRRORS", "https://rutor.info/,https://rutor.org/,https://rutor.is/")
        .split(",")
        if m.strip()
    ]
    TORRENT_LIMIT = int(os.getenv("TORRENT_LIMIT", "15"))

    # Jackett (Torznab) — optional; normalizează sute de trackere în un singur API
    # (inclusiv RuTracker cu cont). Rulezi Jackett local si pui URL + apikey aici.
    TORZNAB_URL = os.getenv("TORZNAB_URL") or None
    TORZNAB_API_KEY = os.getenv("TORZNAB_API_KEY") or None
    TORZNAB_INDEXER = os.getenv("TORZNAB_INDEXER", "all")

    # OpenSubtitles.com — optional; cheie gratuita (cont pe opensubtitles.com ->
    # Developers -> API key). Cu cheie, portalul aduce automat subtitrări RU.
    OS_API_KEY = os.getenv("OS_API_KEY") or None

    # ffmpeg — pentru extragerea subtitrălor muxate în MKV; se poate suprascrie cu FFMPEG_PATH
    FFMPEG_PATH = os.getenv("FFMPEG_PATH") or shutil.which("ffmpeg") or None

    # ---- publicat pe web (VPS/Docker) ----
    # parola de acces; goală = autentificare dezactivată (uz local)
    APP_PASSWORD = os.getenv("APP_PASSWORD") or None
    # secret pentru semnarea sesiunii (generat o dată, păstrat în .env)
    APP_SECRET = os.getenv("APP_SECRET") or None
    # proxy pentru sursele web (Rutor/BTDig blocatează IP-urile de datacenter), ex: http://user:pass@host:port
    PROXY = os.getenv("PROXY") or None

    DETAIL_CACHE_HOURS = float(os.getenv("DETAIL_CACHE_HOURS", "24"))
