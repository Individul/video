# Server web vid — pornit de autostart cu logging de erori
import pathlib
import sys
import traceback

VID = r"C:\Users\prisa\vid"
sys.path.insert(0, VID)

# pythonw nu are stdout/stderr — iau legamint cu un fisier de log
log_path = pathlib.Path(VID) / "autostart" / "server.log"
sys.stdout = open(log_path, "a", buffering=1, encoding="utf-8", errors="replace")
sys.stderr = sys.stdout


def _already_running() -> bool:
    import urllib.request

    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


if _already_running():
    print("serverul ruleaza deja pe :8000 — nu il repornesc", flush=True)
    sys.exit(0)

try:
    import uvicorn
    from app.main import app

    uvicorn.run(app, host="127.0.0.1", port=8000, log_config=None)
except Exception:
    err_file = pathlib.Path(VID) / "autostart" / "error.log"
    err_file.write_text(traceback.format_exc(), encoding="utf-8")
