import pytest

from app.config import Config
from app.sources import subtitles as mod
from app.sources import torrents
from app.sources.base import SourceError

TS = "http://127.0.0.1:8090"
URL_A = f"{TS}/stream/a.mkv?link=aaa&index=1&play"
URL_B = f"{TS}/stream/b.mkv?link=bbb&index=1&play"


class FakeProc:
    def __init__(self):
        self.killed = False

    def poll(self):
        return 0 if self.killed else None

    def kill(self):
        self.killed = True


@pytest.fixture
def jobs(monkeypatch, tmp_path):
    monkeypatch.setattr(Config, "TORRSERVER_URL", TS)
    monkeypatch.setattr(Config, "TORRSERVER_AUTH", None)
    monkeypatch.setattr(Config, "STREAM_PROXY_PATH", None)
    monkeypatch.setattr(Config, "FFMPEG_PATH", "/usr/bin/ffmpeg")
    monkeypatch.setattr(Config, "SERVERLESS", False)
    monkeypatch.setattr(mod, "ROOT", tmp_path)
    monkeypatch.setattr(mod, "_MUX_JOBS", {})
    # ffmpeg nu rulează în teste: jobul rămâne „running” până îl anulăm
    monkeypatch.setattr(mod, "_run_mux_extraction", lambda url, job: None)
    return mod._MUX_JOBS


def test_start_false_doar_verifica(jobs):
    assert mod.mux_job_state(URL_A, start=False) == {"status": "idle", "pct": 0, "error": None}
    assert jobs == {}  # niciun ffmpeg pornit pentru fișierele mari


def test_start_false_raporteaza_job_existent(jobs, monkeypatch):
    monkeypatch.setattr(mod, "_torrserver_progress", lambda url: None)
    assert mod.mux_job_state(URL_A)["status"] == "running"
    assert mod.mux_job_state(URL_A, start=False)["status"] == "running"


def test_o_singura_extragere_odata(jobs):
    mod.mux_job_state(URL_A)
    (job_a,) = jobs.values()
    proc_a = FakeProc()
    job_a["proc"] = proc_a

    mod.mux_job_state(URL_B)  # altă versiune -> extragerea veche se oprește
    assert proc_a.killed
    assert job_a["cancelled"] and job_a["state"] == "error"
    assert len(jobs) == 1 and next(iter(jobs.values()))["state"] == "running"


def test_anulare_opreste_ffmpeg(jobs):
    mod.mux_job_state(URL_A)
    (job,) = jobs.values()
    proc = FakeProc()
    job["proc"] = proc
    assert mod.cancel_mux_job(URL_A) is True
    assert proc.killed and jobs == {}
    assert mod.cancel_mux_job(URL_A) is False  # nimic de anulat a doua oară


def test_anulare_respinge_url_strain(jobs):
    with pytest.raises(SourceError):
        mod.cancel_mux_job("file:///etc/passwd")


async def test_drop_hash_invalid():
    with pytest.raises(SourceError, match="invalid"):
        await torrents.drop_torrent("nu-e-hash")


def test_marimi_fisiere_din_torrserver(monkeypatch):
    monkeypatch.setattr(
        torrents, "_ts_request",
        lambda action, h=None: {"file_stats": [{"id": 1, "length": 10_100_000_000}, {"id": 2, "length": 5}]},
    )
    files = [{"index": 1, "name": "a.mkv"}, {"index": 3, "name": "b.srt"}]
    torrents._attach_file_sizes("a" * 40, files)
    assert files[0]["size"] == 10_100_000_000
    assert "size" not in files[1]


def test_marimi_best_effort(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("TorrServer căzut")

    monkeypatch.setattr(torrents, "_ts_request", boom)
    files = [{"index": 1, "name": "a.mkv"}]
    torrents._attach_file_sizes("a" * 40, files)  # nu aruncă
    assert "size" not in files[0]
