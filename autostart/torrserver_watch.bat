@echo off
rem vid.autostart-backup — dupa 45s, porneste TorrServer daca inca nu ruleaza
ping -n 46 127.0.0.1 > NUL
tasklist /FI "IMAGENAME eq TorrServer-windows-amd64.exe" 2>NUL | find /I "TorrServer" > NUL
if errorlevel 1 (
    start "TorrServer" /MIN "C:\Users\prisa\vid\tools\TorrServer-windows-amd64.exe"
)
