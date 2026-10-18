@echo off
title MindX Automation Bot (v2.1)
color 0A

echo ===================================================
echo     MINDX AUTOMATION BOT - LOCAL SERVER
echo ===================================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js chua duoc cai dat tren may tinh nay.
    echo Vui long cai dat Node.js tai: https://nodejs.org/
    pause
    exit /b 1
)

echo [1/3] Kiem tra moi truong va dependencies...
if not exist node_modules (
    echo [INFO] Dang cai dat dependencies lan dau...
    call npm install
)

echo [2/3] Khoi dong Local Web Server tren 127.0.0.1:3000...
start http://127.0.0.1:3000

echo [3/3] Dang lang nghe ket noi... (Nhan Ctrl+C de dung bot)
echo.
call npm run dev
