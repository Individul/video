@echo off
rem vid.autostart — porneste TorrServer + serverul web + deschide site-ul

rem 1) TorrServer — daca nu ruleaza deja
tasklist /FI "IMAGENAME eq TorrServer-windows-amd64.exe" 2>NUL | find /I "TorrServer" > NUL
if errorlevel 1 (
    start "TorrServer" /MIN "C:\Users\prisa\vid\tools\TorrServer-windows-amd64.exe"
)

rem 2) Serverul web (ascuns, fara consola)
start "" "C:\Users\prisa\vid\.venv\Scripts\pythonw.exe" "C:\Users\prisa\vid\autostart\server.py"

rem Gata: TorrServer + serverul web ruleaza ascuns. Deschide tu http://localhost:8000 cand vrei.
