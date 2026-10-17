@echo off
rem vid.autostart — porneste TorrServer + FlareSolverr + serverul web

rem 1) TorrServer — daca nu ruleaza deja
tasklist /FI "IMAGENAME eq TorrServer-windows-amd64.exe" 2>NUL | find /I "TorrServer" > NUL
if errorlevel 1 (
    start "TorrServer" /MIN "C:\Users\prisa\vid\tools\TorrServer-windows-amd64.exe"
)

rem 2) FlareSolverr (pentru Jackett, depaseste Cloudflare) — daca nu ruleaza deja
tasklist /FI "IMAGENAME eq flaresolverr.exe" 2>NUL | find /I "flaresolverr" > NUL
if errorlevel 1 (
    start "FlareSolverr" /MIN "C:\Users\prisa\vid\tools\flaresolverr\flaresolverr\flaresolverr.exe" --host 127.0.0.1 --port 8191
)

rem 3) Serverul web (ascuns, fara consola)
start "" "C:\Users\prisa\vid\.venv\Scripts\pythonw.exe" "C:\Users\prisa\vid\autostart\server.py"

rem Gata: TorrServer + FlareSolverr + serverul web ruleaza ascuns. Deschide tu http://localhost:8000 cand vrei.
