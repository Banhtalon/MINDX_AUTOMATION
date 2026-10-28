@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title MINDX AUTOMATION BOT - Local Server (127.0.0.1:3000)

cd /d "%~dp0"

echo ==============================================================
echo   MINDX AUTOMATION BOT - KHOI DONG NHANH (WINDOWS)
echo   Sever Local: http://127.0.0.1:3000 (Chi chay noi bo an toan)
echo ==============================================================
echo.

:: 1. Kiem tra Node.js & NPM
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [LOI] Khong tim thay Node.js tren may tinh!
    echo Vui long cai dat Node.js ^(LTS^) tai https://nodejs.org roi chay lai file nay.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [OK] Da tim thay Node.js %NODE_VER%

:: 2. Kiem tra file cau hinh .env.local
if not exist ".env.local" (
    if not exist ".env" (
        if exist ".env.example" (
            copy /Y ".env.example" ".env.local" >nul
            echo [CANH BAO] Chua co file .env.local. Da tao tu .env.example.
            echo Vui long mo file .env.local de dien TEACHING_USERNAME, TEACHING_PASSWORD va GEMINI_API_KEY.
        ) else (
            echo [CANH BAO] Chua tim thay file .env.local. Vui long kiem tra cau hinh tai khoan.
        )
    )
) else (
    echo [OK] Da tim thay file cau hinh .env.local
)

:: 3. Kiem tra thu vien node_modules
if not exist "node_modules\.bin\next.cmd" (
    echo [INFO] Dang cai dat thu vien lan dau ^(npm install^)...
    call npm install --ignore-scripts
    if !errorlevel! neq 0 (
        echo [LOI] Cai dat thu vien that bai!
        pause
        exit /b 1
    )
) else (
    echo [OK] Thu vien node_modules da san sang
)

:: 4. Dam bao thu muc du lieu ton tai
if not exist "data" mkdir "data"
if not exist "playwright-auth" mkdir "playwright-auth"
if not exist "temp_submissions" mkdir "temp_submissions"

:: 5. Khoa cung dia chi Local-Only 127.0.0.1:3000 va tu dong mo trinh duyet
set HOST=127.0.0.1
set PORT=3000

:: Kiem tra xem Server 127.0.0.1:3000 da chay san chua
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>nul
if %errorlevel% equ 0 (
    echo.
    echo [OK] Server MindX Automation Bot dang chay san tai http://127.0.0.1:3000 !
    echo [INFO] Dang mo trinh duyet...
    start http://127.0.0.1:3000
    timeout /t 2 /nobreak >nul
    exit /b 0
)

:: Xoa file lock cu neu lan truoc tat dot ngot
if exist ".next\dev\lock" del /f /q ".next\dev\lock" >nul 2>nul

echo.
echo [INFO] Dang khoi dong server tai http://127.0.0.1:3000 ...
echo [INFO] Trinh duyet se tu dong mo sau vai giay. Nhan Ctrl+C de tat Bot.
echo.

start "" cmd /c "timeout /t 4 /nobreak >nul & start http://127.0.0.1:3000"

call npm run dev
pause
