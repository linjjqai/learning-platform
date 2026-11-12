@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 学习平台 · 本地预览（关掉这个窗口即停止）

echo.
echo   学习平台本地预览
echo   课程库：http://127.0.0.1:4173/
echo   按 Ctrl+C 或直接关窗口停止服务
echo.

start "" http://127.0.0.1:4173/
node "tools\serve.mjs" 4173

echo.
echo 服务已停止。
pause
