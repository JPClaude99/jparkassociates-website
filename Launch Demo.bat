@echo off
rem J Park & Associates — scroll-cinematic demo launcher
rem Double-click to serve the site at http://localhost:8344
cd /d "%~dp0"
echo Serving J Park ^& Associates at http://localhost:8344 ...
start "" http://localhost:8344
python -m http.server 8344
