#!/bin/bash
cd "$(dirname "$0")"

echo "==================================================="
echo "    MINDX AUTOMATION BOT - LOCAL SERVER"
echo "==================================================="
echo ""

if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js chưa được cài đặt trên máy tính này."
    echo "Vui lòng cài đặt Node.js tại: https://nodejs.org/"
    read -p "Nhấn Enter để thoát..."
    exit 1
fi

echo "[1/3] Kiểm tra môi trường..."
if [ ! -d "node_modules" ]; then
    echo "[INFO] Đang cài đặt dependencies..."
    npm install
fi

echo "[2/3] Mở ứng dụng trên trình duyệt..."
sleep 2 && open http://127.0.0.1:3000 &

echo "[3/3] Khởi động Local Web Server trên 127.0.0.1:3000..."
npm run dev
