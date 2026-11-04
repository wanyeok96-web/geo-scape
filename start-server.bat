@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo GeoScape 로컬 서버를 시작합니다: http://localhost:8000
echo 종료하려면 이 창에서 Ctrl+C 를 누르세요.
start "" http://localhost:8000
python -m http.server 8000
