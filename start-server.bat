@echo off
chcp 65001 > nul
cd /d "%~dp0"
title GeoScape
rem 1) Windows 기본 PowerShell 웹 서버 (Python 불필요)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\serve.ps1"
if %errorlevel% equ 0 goto :eof
rem 2) PowerShell 실행이 막힌 PC에서는 Python 서버로 시도
echo PowerShell 서버를 시작하지 못해 Python으로 시도합니다...
where python > nul 2>&1 || (echo Python도 없습니다. index.html 을 직접 열어 사용하세요. & pause & goto :eof)
start "" http://localhost:8000
python -m http.server 8000
