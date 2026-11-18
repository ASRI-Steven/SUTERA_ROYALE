@echo off
rem Dobel-klik (Windows): pantau GitHub ^& tarik update Sutera Royale otomatis. Biarkan jendela ini terbuka.
cd /d "%~dp0"
go run . %*
pause
