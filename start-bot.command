#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "=============================================================="
echo "  MINDX AUTOMATION BOT - KHỞI ĐỘNG NHANH (macOS)"
echo "  Server Local: http://127.0.0.1:3000 (Chỉ chạy nội bộ an toàn)"
echo "=============================================================="
echo ""

# 1. Kiểm tra Node.js & NPM
if ! command -v node >/dev/null 2>&1; then
  echo "[LỖI] Không tìm thấy Node.js trên máy tính!"
  echo "Vui lòng cài đặt Node.js (LTS) tại https://nodejs.org rồi chạy lại file này."
  read -r -p "Nhấn Enter để đóng..."
  exit 1
fi

echo "[OK] Đã tìm thấy Node.js $(node -v)"

# 2. Kiểm tra file cấu hình .env.local
if [ ! -f ".env.local" ] && [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp ".env.example" ".env.local"
    echo "[CẢNH BÁO] Chưa có file .env.local. Đã tạo tự động từ .env.example."
    echo "Vui lòng mở file .env.local để điền TEACHING_USERNAME, TEACHING_PASSWORD và GEMINI_API_KEY."
  else
    echo "[CẢNH BÁO] Chưa tìm thấy file .env.local. Vui lòng kiểm tra cấu hình tài khoản."
  fi
else
  echo "[OK] Đã tìm thấy file cấu hình môi trường (.env.local / .env)"
fi

# 3. Kiểm tra thư viện node_modules
if [ ! -d "node_modules" ]; then
  echo "[INFO] Đang cài đặt thư viện lần đầu (npm install)..."
  npm install
else
  echo "[OK] Thư viện node_modules đã sẵn sàng"
fi

# 4. Đảm bảo thư mục dữ liệu tồn tại
mkdir -p data playwright-auth temp_submissions

# 5. Khóa cứng địa chỉ Local-Only 127.0.0.1:3000 và tự động mở trình duyệt
export HOST="127.0.0.1"
export PORT="3000"

echo ""
echo "[INFO] Đang khởi động server tại http://127.0.0.1:3000 ..."
echo "[INFO] Trình duyệt sẽ tự động mở sau vài giây. Nhấn Ctrl+C để tắt Bot."
echo ""

(
  sleep 4
  if command -v open >/dev/null 2>&1; then
    open "http://127.0.0.1:3000"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://127.0.0.1:3000"
  fi
) &

npm run dev
