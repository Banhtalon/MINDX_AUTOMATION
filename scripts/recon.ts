import path from "node:path";
import fs from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../src/lib/config";

// Directory to store persistent browser profile (cookies, session, local storage)
const AUTH_DIR = path.resolve(process.cwd(), "playwright-auth");

async function testGeminiConnection() {
  console.log("\n==================================================");
  console.log("🤖 BƯỚC 1: KIỂM TRA KẾT NỐI GEMINI AI ENGINE");
  console.log("==================================================");

  if (!config.geminiApiKey || config.geminiApiKey === "your_gemini_api_key_here") {
    console.log("⚠️  Chưa cấu hình GEMINI_API_KEY trong .env.local.");
    console.log("👉 Vui lòng mở file .env.local và điền GEMINI_API_KEY từ Google AI Studio để thử nghiệm AI.");
    return false;
  }

  try {
    const startTime = Date.now();
    console.log(`Đang gọi Gemini Model: ${config.geminiModel}...`);

    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: config.geminiModel,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const prompt = `Bạn là trợ lý khảo sát của MindX Automation Bot. Hãy trả về một JSON hợp lệ kiểm tra kết nối với cấu trúc:
{
  "status": "CONNECTED",
  "botVersion": "2.1",
  "message": "Kết nối thành công tới Gemini 3.5 Flash Lite!",
  "sampleComment": {
    "strengths": "Nắm vững cú pháp cơ bản",
    "improvements": "Cần chú ý thụt lề khi viết hàm",
    "actionPlan": "Luyện tập thêm bài 2 trên LMS"
  }
}`;

    const result = await model.generateContent(prompt);
    const latency = Date.now() - startTime;
    const responseText = result.response.text();

    console.log(`✅ Kết nối Gemini AI thành công! (Thời gian phản hồi: ${latency}ms)`);
    console.log("Phản hồi mẫu:", JSON.parse(responseText));
    return true;
  } catch (err) {
    console.error("❌ Lỗi kết nối Gemini API:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function runBrowserRecon() {
  console.log("\n==================================================");
  console.log("🌐 BƯỚC 2: KHẢO SÁT HỆ THỐNG TEACHING & LMS (PLAYWRIGHT)");
  console.log("==================================================");

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  console.log(`📁 Persistent Auth Profile: ${AUTH_DIR}`);
  console.log(`🔗 Tab 1 (Teaching): ${config.teachingUrl}`);
  console.log(`🔗 Tab 2 (LMS):      ${config.lmsUrl}`);
  console.log("Đang khởi động trình duyệt Chromium có giao diện...");

  const context: BrowserContext = await chromium.launchPersistentContext(AUTH_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--start-maximized",
    ],
  });

  // Intercept and log API network requests across ALL pages/tabs
  context.on("request", (req) => {
    const url = req.url();
    if (
      url.includes("/api/") ||
      url.includes("/graphql") ||
      url.includes("attendance") ||
      url.includes("class") ||
      url.includes("session") ||
      url.includes("submission") ||
      url.includes("student")
    ) {
      console.log(`📡 [Network Request] ${req.method()} ${url.slice(0, 130)}`);
    }
  });

  context.on("response", async (res) => {
    const url = res.url();
    const status = res.status();
    if (
      url.includes("/api/") ||
      url.includes("/graphql") ||
      url.includes("attendance") ||
      url.includes("class") ||
      url.includes("session") ||
      url.includes("submission") ||
      url.includes("student")
    ) {
      console.log(`📥 [Network Response] ${status} ${url.slice(0, 130)}`);
    }
  });

  // Tab 1: Teaching
  const teachingPage: Page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  console.log("\n👉 Tab 1: Đang mở trang Teaching MindX...");
  try {
    await teachingPage.goto(config.teachingUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (err) {
    console.log(`⚠️ Tab 1: Không thể tải ${config.teachingUrl} (Kiểm tra lại đường dẫn mạng).`);
  }

  // Tab 2: LMS
  console.log("👉 Tab 2: Đang mở trang MindX LMS...");
  const lmsPage: Page = await context.newPage();
  try {
    await lmsPage.goto(config.lmsUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (err) {
    console.log(`⚠️ Tab 2: Không thể tải ${config.lmsUrl} (Kiểm tra lại đường dẫn mạng).`);
  }

  console.log("\n==================================================");
  console.log("📋 HƯỚNG DẪN DÀNH CHO GIÁO VIÊN TRONG PHIÊN KHẢO SÁT:");
  console.log("1. Trình duyệt đã mở sẵn 2 Tab:");
  console.log("   - Tab 1: Hệ thống Teaching (Lịch dạy)");
  console.log("   - Tab 2: Hệ thống MindX LMS (Quản lý lớp, Học viên, Chấm bài & SPCK)");
  console.log("2. Đăng nhập tài khoản:");
  console.log("   - Nếu dùng chung 1 tài khoản MindX: Đăng nhập cả 2 tab bằng cùng tài khoản đó.");
  console.log("   - Nếu Teaching và LMS có tài khoản/mật khẩu riêng: Đăng nhập tương ứng vào từng tab.");
  console.log("   👉 Phiên đăng nhập của CẢ 2 TRANG sẽ được lưu vĩnh viễn vào ./playwright-auth!");
  console.log("3. Trên tab LMS, mở thử 1 lớp học thật để kiểm tra:");
  console.log("   - Tab Học viên (xem nút trạng thái Active màu xanh)");
  console.log("   - Tab Lịch học / Điểm danh");
  console.log("   - Tab Chấm bài (mở thử Modal xem file nộp và nút download)");
  console.log("   - Tab Sản phẩm cuối khóa (SPCK)");
  console.log("4. Các request API nghiệp vụ sẽ tự động được ghi nhận tại terminal này.");
  console.log("5. Khi hoàn tất, quay lại cửa sổ Terminal này và nhấn phím [Enter] để đóng trình duyệt.");
  console.log("==================================================\n");

  // Keep script alive until teacher presses Enter
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      resolve();
    });
  });

  console.log("Đang đóng trình duyệt và lưu phiên đăng nhập của cả 2 trang...");
  await context.close();
  console.log("✅ Đã lưu profile thành công vào ./playwright-auth!");
}

async function main() {
  console.log("==================================================");
  console.log("🚀 MINDX AUTOMATION BOT - CÔNG CỤ KHẢO SÁT (RECON)");
  console.log("==================================================");

  // 1. Test Gemini
  await testGeminiConnection();

  // 2. Test Playwright & LMS/Teaching Recon
  await runBrowserRecon();

  console.log("\n🎉 Khảo sát hoàn tất. Dữ liệu đã sẵn sàng để chuyển sang Giai đoạn tiếp theo!");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Lỗi thực thi scripts/recon.ts:", err);
  process.exit(1);
});
