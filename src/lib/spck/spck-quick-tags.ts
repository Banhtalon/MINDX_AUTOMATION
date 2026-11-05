/**
 * MINDX AUTOMATION BOT - SUBJECT-AWARE & SESSION-AWARE SPCK QUICK TAGS
 * Pure TypeScript module (safe for both Client Components and Server Routes/AI Prompts).
 *
 * Covers all 6 MindX subject tracks and sub-courses across Sessions 12, 13, and 14:
 * 1. SCRATCH: SB (Basic), SA (Advance), SI (Intensive - Micro:bit)
 * 2. GAMEMAKER: GB (Basic), GA (Advance - GML), GI (Intensive - FSM/Boss/Camera)
 * 3. PYTHON_APP: PTB (Basic CLI/Logic), PTA (Advance PyQt6 GUI & OOP), PTI (Intensive PyQt6 + JSON CRUD)
 * 4. WEB: JSB (HTML/CSS/Bootstrap/DOM), JSA (ES6/LocalStorage/Fetch API), JSI (Firebase Auth/Firestore/AI)
 * 5. COMPUTER_SCIENCE: CSB (OOP/Search/Sort/Stack/Queue), CSA (Pandas/Chart/Sklearn/Streamlit), CSI (ML/DL/OpenCV/LLM/Streamlit)
 * 6. ROBOTICS: PREB/PREA/PREI (VEX GO), ARMB/ARMA/ARMI (VEX IQ), SEMIB/SEMIA/SEMII & ROB (Robotics/Semiconductor)
 */

export type SpckSubjectTrack =
  | "SCRATCH"
  | "GAMEMAKER"
  | "PYTHON_APP"
  | "WEB"
  | "COMPUTER_SCIENCE"
  | "ROBOTICS"
  | "GENERAL";

export type SpckCoursePrefix =
  | "SB"
  | "SA"
  | "SI"
  | "GB"
  | "GA"
  | "GI"
  | "PTB"
  | "PTA"
  | "PTI"
  | "JSB"
  | "JSA"
  | "JSI"
  | "CSB"
  | "CSA"
  | "CSI"
  | "PREB"
  | "PREA"
  | "PREI"
  | "ARMB"
  | "ARMA"
  | "ARMI"
  | "SEMIB"
  | "SEMIA"
  | "SEMII"
  | "ROB"
  | "GENERAL";

export type SpckSubTrack =
  | "SCRATCH_BASIC"
  | "SCRATCH_ADVANCE"
  | "SCRATCH_MICROBIT"
  | "GAMEMAKER_BASIC"
  | "GAMEMAKER_GML"
  | "GAMEMAKER_FSM"
  | "PYTHON_CLI"
  | "PYTHON_GUI"
  | "WEB_BASIC"
  | "WEB_JS"
  | "WEB_FIREBASE"
  | "CS_ALGO"
  | "CS_DATA_STREAMLIT"
  | "CS_AI_STREAMLIT"
  | "ROBOTICS_VEXGO"
  | "ROBOTICS_VEXIQ"
  | "ROBOTICS_GENERAL"
  | "GENERAL";

export interface SpckCourseProfile {
  coursePrefix: SpckCoursePrefix;
  track: SpckSubjectTrack;
  subTrack: SpckSubTrack;
  trackBadgeLabel: string;
  productNoun: string;
  coreSkillsSummary: string;
}

export interface SpckQuickTagGroup {
  id: "progress" | "next_step" | "presentation" | "product";
  title: string;
  tone: "emerald" | "amber" | "violet" | "indigo";
  tags: string[];
}

export interface SpckSessionQuickTagsBundle {
  profile: SpckCourseProfile;
  sessionNumber: 12 | 13 | 14;
  groups: SpckQuickTagGroup[];
  optionalPresentationGroup?: SpckQuickTagGroup;
  allAvailableTags: string[];
}

const COURSE_PROFILES: Record<SpckCoursePrefix, SpckCourseProfile> = {
  SB: {
    coursePrefix: "SB",
    track: "SCRATCH",
    subTrack: "SCRATCH_BASIC",
    trackBadgeLabel: "Scratch Basic (SB)",
    productNoun: "dự án trò chơi / hoạt hình Scratch",
    coreSkillsSummary:
      "thiết kế nhân vật (Sprites), phông nền (Backdrops), kịch bản khối lệnh sự kiện, vòng lặp, điều kiện va chạm, biến điểm số và âm thanh",
  },
  SA: {
    coursePrefix: "SA",
    track: "SCRATCH",
    subTrack: "SCRATCH_ADVANCE",
    trackBadgeLabel: "Scratch Advance (SA)",
    productNoun: "dự án trò chơi Scratch nâng cao",
    coreSkillsSummary:
      "bản sao (Clone), tự định nghĩa khối lệnh (My Blocks), biến cục bộ/toàn cục, danh sách (Lists), truyền thông điệp (Broadcast) và tích hợp mô hình AI/Teachable Machine",
  },
  SI: {
    coursePrefix: "SI",
    track: "SCRATCH",
    subTrack: "SCRATCH_MICROBIT",
    trackBadgeLabel: "Scratch Intensive & Micro:bit (SI)",
    productNoun: "dự án Scratch kết hợp phần cứng Micro:bit",
    coreSkillsSummary:
      "kết nối mạch Micro:bit với Scratch, lập trình cảm biến nghiêng/gia tốc, nút bấm A/B, hiển thị LED ma trận, truyền thông điệp điều khiển nhân vật và xử lý logic trò chơi",
  },
  GB: {
    coursePrefix: "GB",
    track: "GAMEMAKER",
    subTrack: "GAMEMAKER_BASIC",
    trackBadgeLabel: "GameMaker Basic (GB)",
    productNoun: "trò chơi 2D trên GameMaker",
    coreSkillsSummary:
      "thiết kế Sprites, Objects, Rooms (màn chơi), Tilesets, sự kiện Create/Step/Collision, quản lý điểm số (Score), mạng sống (Lives/Health) và âm thanh",
  },
  GA: {
    coursePrefix: "GA",
    track: "GAMEMAKER",
    subTrack: "GAMEMAKER_GML",
    trackBadgeLabel: "GameMaker Advance (GA)",
    productNoun: "trò chơi 2D lập trình GML trên GameMaker",
    coreSkillsSummary:
      "lập trình ngôn ngữ GML, cơ chế trọng lực & di chuyển (Platformer/Tower Defense), bộ đếm Alarm sinh quái (Spawner), xử lý va chạm, giao diện HUD và âm thanh",
  },
  GI: {
    coursePrefix: "GI",
    track: "GAMEMAKER",
    subTrack: "GAMEMAKER_FSM",
    trackBadgeLabel: "GameMaker Intensive (GI)",
    productNoun: "dự án Game 2D chuyên sâu trên GameMaker",
    coreSkillsSummary:
      "máy trạng thái hữu hạn (FSM: Idle/Move/Attack/Hit), Camera & Viewports bám nhân vật, hệ thống chiến đấu/Boss đa pha, kỹ năng nhân vật và hiệu ứng hình ảnh",
  },
  PTB: {
    coursePrefix: "PTB",
    track: "PYTHON_APP",
    subTrack: "PYTHON_CLI",
    trackBadgeLabel: "Python Basic (PTB)",
    productNoun: "chương trình ứng dụng Python",
    coreSkillsSummary:
      "cấu trúc điều kiện if-elif-else, vòng lặp for/while, quản lý danh sách (List/Dictionary), tách hàm (def), kiểm tra dữ liệu nhập và luồng menu chức năng",
  },
  PTA: {
    coursePrefix: "PTA",
    track: "PYTHON_APP",
    subTrack: "PYTHON_GUI",
    trackBadgeLabel: "Python App PyQt6 (PTA)",
    productNoun: "ứng dụng giao diện PyQt6",
    coreSkillsSummary:
      "thiết kế giao diện Qt Designer (.ui), lập trình hướng đối tượng (OOP class), kết nối sự kiện Signal & Slot, chuyển đổi màn hình QStackedWidget và thông báo QMessageBox",
  },
  PTI: {
    coursePrefix: "PTI",
    track: "PYTHON_APP",
    subTrack: "PYTHON_GUI",
    trackBadgeLabel: "Python Intensive PyQt6 (PTI)",
    productNoun: "ứng dụng quản lý PyQt6 & dữ liệu JSON",
    coreSkillsSummary:
      "giao diện đa màn hình Qt Designer (.ui) & QSS (.qss), kiến trúc OOP, lưu trữ/đọc dữ liệu .json, chức năng Thêm/Sửa/Xóa (CRUD), Tìm kiếm & Lọc danh sách",
  },
  JSB: {
    coursePrefix: "JSB",
    track: "WEB",
    subTrack: "WEB_BASIC",
    trackBadgeLabel: "Web Basic (JSB)",
    productNoun: "website đa trang",
    coreSkillsSummary:
      "cấu trúc HTML5 ngữ nghĩa, dàn trang CSS Flexbox/Grid, phong cách giao diện đồng bộ, thanh điều hướng giữa các trang và tương tác JavaScript DOM cơ bản",
  },
  JSA: {
    coursePrefix: "JSA",
    track: "WEB",
    subTrack: "WEB_JS",
    trackBadgeLabel: "Web Advance (JSA)",
    productNoun: "ứng dụng Web tương tác JavaScript",
    coreSkillsSummary:
      "HTML/CSS Flexbox & Grid, JavaScript ES6, hiển thị dữ liệu động trên DOM và xử lý các tính năng tương tác theo đúng chủ đề dự án",
  },
  JSI: {
    coursePrefix: "JSI",
    track: "WEB",
    subTrack: "WEB_FIREBASE",
    trackBadgeLabel: "Web Intensive Firebase (JSI)",
    productNoun: "ứng dụng Web kết nối Firebase & Cloud",
    coreSkillsSummary:
      "kiến trúc ứng dụng Web nâng cao, JavaScript Modules/bất đồng bộ, kết nối dịch vụ xác thực/cơ sở dữ liệu Cloud Firestore và đồng bộ dữ liệu theo chủ đề dự án",
  },
  CSB: {
    coursePrefix: "CSB",
    track: "COMPUTER_SCIENCE",
    subTrack: "CS_ALGO",
    trackBadgeLabel: "Computer Science Basic (CSB)",
    productNoun: "ứng dụng thuật toán & cấu trúc dữ liệu Python",
    coreSkillsSummary:
      "lập trình hướng đối tượng (OOP), thuật toán Tìm kiếm (Linear/Binary Search), thuật toán Sắp xếp (Bubble/Selection/Insertion/Merge/Quick Sort), cấu trúc Stack/Queue và tối ưu độ phức tạp",
  },
  CSA: {
    coursePrefix: "CSA",
    track: "COMPUTER_SCIENCE",
    subTrack: "CS_DATA_STREAMLIT",
    trackBadgeLabel: "Computer Science Advance - Data & Streamlit (CSA)",
    productNoun: "dự án phân tích dữ liệu & Dashboard Streamlit",
    coreSkillsSummary:
      "thu thập và làm sạch dữ liệu với Pandas (.csv), phân tích khám phá (EDA), trực quan hóa biểu đồ Matplotlib/Seaborn, mô hình Scikit-learn cơ bản và ứng dụng web Streamlit",
  },
  CSI: {
    coursePrefix: "CSI",
    track: "COMPUTER_SCIENCE",
    subTrack: "CS_AI_STREAMLIT",
    trackBadgeLabel: "Computer Science Intensive - AI & Streamlit (CSI)",
    productNoun: "ứng dụng Trí tuệ nhân tạo (AI / Machine Learning) trên Streamlit",
    coreSkillsSummary:
      "tiền xử lý dữ liệu, huấn luyện và đánh giá mô hình Machine Learning / Deep Learning (Scikit-learn, Keras/TensorFlow, OpenCV hoặc LLM API) và triển khai giao diện dự đoán trực tuyến với Streamlit",
  },
  PREB: {
    coursePrefix: "PREB",
    track: "ROBOTICS",
    subTrack: "ROBOTICS_VEXGO",
    trackBadgeLabel: "Robotics VEX GO Basic (PREB)",
    productNoun: "mô hình robot VEX GO",
    coreSkillsSummary:
      "lắp ráp cơ khí VEX GO (chốt nối, bánh răng, đòn bẩy, kết cấu chịu lực), kết nối bộ não Brain & cảm biến, lập trình khối lệnh VEXcode GO điều khiển chuyển động",
  },
  PREA: {
    coursePrefix: "PREA",
    track: "ROBOTICS",
    subTrack: "ROBOTICS_VEXGO",
    trackBadgeLabel: "Robotics VEX GO Advance (PREA)",
    productNoun: "mô hình robot tự hành VEX GO",
    coreSkillsSummary:
      "lắp ráp cơ cấu truyền động bánh răng & tay gắp VEX GO, sử dụng cảm biến Eye Sensor / Bumper Switch / LED Bumper và lập trình điều kiện if-else, vòng lặp trên VEXcode GO",
  },
  PREI: {
    coursePrefix: "PREI",
    track: "ROBOTICS",
    subTrack: "ROBOTICS_VEXGO",
    trackBadgeLabel: "Robotics VEX GO Intensive (PREI)",
    productNoun: "dự án tổ hợp robot thông minh VEX GO",
    coreSkillsSummary:
      "thiết kế cơ khí sáng tạo VEX GO, phối hợp đa cảm biến với khối lệnh tự định nghĩa (My Blocks), biến số và thuật toán tự hành giải quyết nhiệm vụ thực tế trên sa bàn",
  },
  ARMB: {
    coursePrefix: "ARMB",
    track: "ROBOTICS",
    subTrack: "ROBOTICS_VEXIQ",
    trackBadgeLabel: "Robotics VEX IQ Basic (ARMB)",
    productNoun: "mô hình robot VEX IQ",
    coreSkillsSummary:
      "lắp ráp khung gầm Drivetrain và cơ cấu cơ khí VEX IQ, kết nối Smart Motors & Sensors, lập trình điều khiển chuyển động và thực hiện nhiệm vụ trên sa bàn",
  },
  ARMA: {
    coursePrefix: "ARMA",
    track: "ROBOTICS",
    subTrack: "ROBOTICS_VEXIQ",
    trackBadgeLabel: "Robotics VEX IQ Advance (ARMA)",
    productNoun: "mô hình cánh tay robot & tự hành VEX IQ",
    coreSkillsSummary:
      "thiết kế tay gắp / cơ cấu nâng hạ tỷ số truyền bánh răng VEX IQ, tích hợp cảm biến Gyro / Distance / Optical và lập trình tự hành kết hợp điều khiển tay cầm Controller",
  },
  ARMI: {
    coursePrefix: "ARMI",
    track: "ROBOTICS",
    subTrack: "ROBOTICS_VEXIQ",
    trackBadgeLabel: "Robotics VEX IQ Intensive (ARMI)",
    productNoun: "hệ thống robot thi đấu & tự động hóa VEX IQ",
    coreSkillsSummary:
      "tối ưu kết cấu cơ khí đa bậc tự do VEX IQ, lập trình thuật toán tự hành chính xác theo cảm biến, xử lý đa nhiệm và vận hành ổn định trong thử thách thực tế",
  },
  SEMIB: {
    coursePrefix: "SEMIB",
    track: "ROBOTICS",
    subTrack: "ROBOTICS_GENERAL",
    trackBadgeLabel: "Robotics & Bán dẫn Basic (SEMIB)",
    productNoun: "mô hình mạch điện tử & robot thực nghiệm",
    coreSkillsSummary:
      "lắp ráp mô hình phần cứng, kết nối linh kiện cảm biến - cơ cấu chấp hành và lập trình kịch bản điều khiển tự động",
  },
  SEMIA: {
    coursePrefix: "SEMIA",
    track: "ROBOTICS",
    subTrack: "ROBOTICS_GENERAL",
    trackBadgeLabel: "Robotics & Bán dẫn Advance (SEMIA)",
    productNoun: "hệ thống mạch cảm biến & tự động hóa",
    coreSkillsSummary:
      "thiết kế mô hình phần cứng - cảm biến, đọc dữ liệu tín hiệu đầu vào, lập trình logic phản hồi tự động và hiệu chỉnh thông số vận hành",
  },
  SEMII: {
    coursePrefix: "SEMII",
    track: "ROBOTICS",
    subTrack: "ROBOTICS_GENERAL",
    trackBadgeLabel: "Robotics & Bán dẫn Intensive (SEMII)",
    productNoun: "sản phẩm kỹ thuật tự động hóa tích hợp",
    coreSkillsSummary:
      "tích hợp phần cứng - cảm biến - cơ cấu điều khiển thông minh, tối ưu độ ổn định vận hành thực tế và trình bày giải pháp kỹ thuật",
  },
  ROB: {
    coursePrefix: "ROB",
    track: "ROBOTICS",
    subTrack: "ROBOTICS_GENERAL",
    trackBadgeLabel: "Robotics (ROB)",
    productNoun: "mô hình lắp ráp & lập trình Robot",
    coreSkillsSummary:
      "lắp ráp kết cấu cơ khí vững chắc, kết nối động cơ và cảm biến, lập trình điều khiển robot vận hành chính xác theo yêu cầu đề tài",
  },
  GENERAL: {
    coursePrefix: "GENERAL",
    track: "GENERAL",
    subTrack: "GENERAL",
    trackBadgeLabel: "Lập trình & Công nghệ",
    productNoun: "sản phẩm cuối khóa",
    coreSkillsSummary:
      "thiết kế giao diện/mô hình, xây dựng các tính năng cốt lõi, vận dụng cấu trúc lập trình đã học và kiểm thử hoàn thiện sản phẩm",
  },
};

/**
 * Detects the exact MindX course prefix and subject track from `classId`, `courseName`,
 * and optionally a list of project file extensions found in the student's folder.
 */
export function detectSpckCourseProfile(
  classId?: string | null,
  courseName?: string | null,
  fileExtensions?: string[]
): SpckCourseProfile {
  const combined = `${String(classId || "")} ${String(courseName || "")}`.toUpperCase();

  // 1. Check multi-letter unambiguous prefixes first
  const orderedTokenPrefixes: SpckCoursePrefix[] = [
    "SEMII",
    "SEMIA",
    "SEMIB",
    "ARMI",
    "ARMA",
    "ARMB",
    "PREI",
    "PREA",
    "PREB",
    "PTI",
    "PTA",
    "PTB",
    "JSI",
    "JSA",
    "JSB",
    "CSI",
    "CSA",
    "CSB",
    "ROB",
    "SI",
    "SA",
    "SB",
    "GI",
    "GA",
    "GB",
  ];

  for (const prefix of orderedTokenPrefixes) {
    // Match prefix bounded by non-letter or followed by digits (e.g., VT-C4K-SB28, TEST_V270_PTB_01, HN-JSA08)
    const regex = new RegExp(`(?:^|[^A-Z])(${prefix})(?:\\d|$|[^A-Z])`, "i");
    if (regex.test(combined)) {
      return COURSE_PROFILES[prefix];
    }
  }

  // 2. Check descriptive keywords in classId or courseName
  if (/VEX\s*IQ|ARM/i.test(combined)) return COURSE_PROFILES.ARMA;
  if (/VEX\s*GO|KID\s*ENGINEER/i.test(combined)) return COURSE_PROFILES.PREB;
  if (/ROBOT|BÁN\s*DẪN|SEMI/i.test(combined)) return COURSE_PROFILES.ROB;
  if (/MICRO\s*:?\s*BIT/i.test(combined)) return COURSE_PROFILES.SI;
  if (/SCRATCH/i.test(combined)) return COURSE_PROFILES.SB;
  if (/GAME\s*MAKER|GAMEMAKER/i.test(combined)) return COURSE_PROFILES.GA;
  if (/PYQT|QT\s*DESIGNER|PYTHON\s*APP/i.test(combined)) return COURSE_PROFILES.PTA;
  if (/PYTHON/i.test(combined)) return COURSE_PROFILES.PTB;
  if (/STREAMLIT|PANDAS|DATA\s*SCIENCE/i.test(combined)) return COURSE_PROFILES.CSA;
  if (/DEEP\s*LEARNING|MACHINE\s*LEARNING|OPENCV/i.test(combined)) return COURSE_PROFILES.CSI;
  if (/COMPUTER\s*SCIENCE|THUẬT\s*TOÁN/i.test(combined)) return COURSE_PROFILES.CSB;
  if (/FIREBASE|FIRESTORE/i.test(combined)) return COURSE_PROFILES.JSI;
  if (/LOCALSTORAGE|FETCH\s*API/i.test(combined)) return COURSE_PROFILES.JSA;
  if (/(?:^|[^A-Z])(WEB|HTML|CSS|JAVASCRIPT|JS)(?:$|[^A-Z])/i.test(combined)) {
    return COURSE_PROFILES.JSB;
  }

  // 3. Optional refinement from student's actual project files
  if (Array.isArray(fileExtensions) && fileExtensions.length > 0) {
    const exts = new Set(
      fileExtensions.map((e) => (e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`))
    );
    if (exts.has(".sb3")) return COURSE_PROFILES.SB;
    if (exts.has(".yyz") || exts.has(".yyp") || exts.has(".gml")) return COURSE_PROFILES.GA;
    if (exts.has(".ui") || exts.has(".qss")) return COURSE_PROFILES.PTA;
    if (exts.has(".ipynb") || exts.has(".csv")) return COURSE_PROFILES.CSA;
    if (exts.has(".html") || exts.has(".css")) return COURSE_PROFILES.JSB;
    if (exts.has(".py")) return COURSE_PROFILES.PTB;
  }

  return COURSE_PROFILES.GENERAL;
}

const OPTIONAL_SESSION_12_13_PRESENTATION_TAGS: string[] = [
  "🎤 Tập thuyết trình thử rõ ràng, nắm được ý chính của dự án",
  "⚠️ Phần trình bày thử còn ngập ngừng, cần luyện nói lưu loát hơn",
];

const SESSION_14_PRESENTATION_TAGS: string[] = [
  "📊 Slide đẹp, bố cục rõ ràng, dễ nhìn",
  "🗣️ Trình bày tự tin, to rõ, mạch lạc",
  "💡 Giải thích tốt luồng hoạt động & ý tưởng sản phẩm",
  "❓ Phản biện tốt, trả lời đúng trọng tâm câu hỏi",
  "⚠️ Thuyết trình còn rụt rè, cần rèn thêm sự tự tin",
];

interface TrackStageTagConfig {
  session12: {
    progress: string[];
    nextStep: string[];
  };
  session13: {
    progress: string[];
    nextStep: string[];
  };
  session14Product: string[];
}

function getSubTrackTagConfig(profile: SpckCourseProfile): TrackStageTagConfig {
  switch (profile.subTrack) {
    // =========================================================================
    // 1. SCRATCH (SB / SA / SI)
    // =========================================================================
    case "SCRATCH_BASIC":
      return {
        session12: {
          progress: [
            "✅ Đã hoàn thành nhân vật (Sprites) & phông nền (Backdrops) chính",
            "🎮 Đã lập trình khối lệnh di chuyển & sự kiện cơ bản cho nhân vật",
            "💬 Đã xây dựng kịch bản mở đầu / hội thoại dẫn chuyện rõ ràng",
            "💡 Ý tưởng trò chơi / câu chuyện sáng tạo, hình ảnh sinh động",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện thêm xử lý va chạm, tính điểm & điều kiện Thắng/Thua ở buổi 13",
            "🎵 Cần bổ sung thêm hiệu ứng âm thanh, chuyển cảnh & màn chơi phụ",
            "⏳ Tiến độ dựng kịch bản hơi chậm, cần đẩy nhanh các khối lệnh chính",
          ],
        },
        session13: {
          progress: [
            "✅ Đã hoàn thiện luồng chơi chính, biến điểm số & điều kiện Thắng/Thua",
            "🔊 Đã tích hợp hiệu ứng âm thanh, trang phục (Costumes) & chuyển cảnh mượt",
            "🐞 Chủ động chạy thử kịch bản và sửa lỗi va chạm / kẹt nhân vật",
            "✨ Bổ sung thêm vật phẩm thưởng / thử thách giúp trò chơi hấp dẫn hơn",
          ],
          nextStep: [
            "🔧 Cần rà soát lại các lỗi nhỏ khi chơi lại từ đầu (Reset biến/vị trí)",
            "📊 Cần hoàn thiện Slide giới thiệu & luyện tập thuyết trình cho buổi 14",
            "🎨 Cần căn chỉnh lại vị trí nhân vật & chữ hiển thị trên sân khấu cho gọn",
          ],
        },
        session14Product: [
          "🎨 Thiết kế nhân vật (Sprites) & sân khấu (Backdrops) sinh động, bắt mắt",
          "🧩 Vận dụng tốt khối lệnh sự kiện, vòng lặp, điều kiện & biến điểm số",
          "🎮 Kịch bản trò chơi / hoạt hình hoàn chỉnh, tương tác & âm thanh mượt mà",
          "🌟 Ý tưởng sáng tạo, có thông điệp rõ ràng và tính giải trí cao",
          "🔧 Cần tinh chỉnh thêm độ cân bằng màn chơi & hiệu ứng chuyển cảnh",
        ],
      };

    case "SCRATCH_ADVANCE":
      return {
        session12: {
          progress: [
            "✅ Đã thiết kế xong hệ thống nhân vật, phông nền & bố cục màn chơi",
            "🧩 Đã áp dụng Bản sao (Clone) / truyền tin (Broadcast) cho luồng chính",
            "📦 Đã bước đầu tổ chức khối lệnh riêng (My Blocks) & biến trạng thái",
            "💡 Ý tưởng gameplay sáng tạo, có chiều sâu và nhiều thử thách",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện logic sinh bản sao (Clone), danh sách (List) & tính điểm ở buổi 13",
            "🤖 Cần tinh chỉnh thêm phần nhận diện AI / xử lý va chạm nâng cao",
            "⏳ Tiến độ còn chậm ở phần kịch bản nâng cao, cần tập trung hoàn thiện",
          ],
        },
        session13: {
          progress: [
            "✅ Đã hoàn thiện cơ chế Clone, My Blocks, Broadcast & hệ thống điểm/mạng",
            "🎮 Gameplay vận hành trơn tru qua các cấp độ, có màn Thắng/Thua rõ ràng",
            "🐞 Chủ động kiểm thử và xử lý tốt lỗi trùng lặp bản sao (Delete Clone)",
            "🔊 Đã tích hợp đầy đủ hiệu ứng hình ảnh, âm thanh và bảng thông số",
          ],
          nextStep: [
            "🔧 Cần tối ưu lại các đoạn khối lệnh dài & kiểm tra lỗi biên khi chơi nhanh",
            "📊 Cần hoàn thiện Slide thuyết trình & kịch bản demo sản phẩm buổi 14",
            "⚖️ Cần cân bằng lại tốc độ/độ khó giữa các màn chơi cho hợp lý hơn",
          ],
        },
        session14Product: [
          "🎨 Đồ họa nhân vật, hiệu ứng chuyển động & giao diện màn chơi chỉn chu",
          "🧩 Vận dụng vững vàng Clone, My Blocks, Lists & Broadcast trong Scratch",
          "🎮 Cơ chế gameplay cuốn hút, xử lý va chạm và tính điểm chính xác",
          "🌟 Tích hợp sáng tạo tính năng nâng cao / mô hình AI vào dự án",
          "🔧 Cần tối ưu thêm hiệu năng khi xuất hiện nhiều bản sao (Clone) cùng lúc",
        ],
      };

    case "SCRATCH_MICROBIT":
      return {
        session12: {
          progress: [
            "✅ Đã thiết kế xong nhân vật, sân khấu Scratch & kịch bản tương tác",
            "🔌 Đã kết nối mạch Micro:bit và nhận tín hiệu nút bấm / cảm biến cơ bản",
            "📟 Đã lập trình hiển thị biểu tượng LED ma trận phản hồi trên Micro:bit",
            "💡 Ý tưởng kết hợp điều khiển phần cứng Micro:bit với trò chơi rất sáng tạo",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện độ nhạy cảm biến nghiêng / nút bấm Micro:bit ở buổi 13",
            "🎮 Cần bổ sung đầy đủ luật tính điểm, va chạm & điều kiện Thắng/Thua",
            "⏳ Tiến độ đồng bộ tín hiệu giữa Micro:bit và Scratch cần đẩy nhanh hơn",
          ],
        },
        session13: {
          progress: [
            "✅ Đã đồng bộ mượt mà điều khiển Micro:bit (nút bấm/nghiêng) với nhân vật Scratch",
            "🎮 Đã hoàn thiện luật chơi, điểm số, âm thanh và phản hồi đèn LED Micro:bit",
            "🐞 Chủ động kiểm thử thực tế trên mạch và tinh chỉnh độ trễ tín hiệu",
            "✨ Bổ sung thêm nhiều cấp độ thử thách tăng trải nghiệm tương tác phần cứng",
          ],
          nextStep: [
            "🔧 Cần kiểm tra kỹ kết nối Bluetooth/Scratch Link ổn định trước buổi bảo vệ",
            "📊 Cần hoàn thiện Slide trình bày sơ đồ điều khiển Micro:bit cho buổi 14",
            "⚖️ Cần tinh chỉnh lại ngưỡng cảm biến nghiêng để điều khiển dễ dàng hơn",
          ],
        },
        session14Product: [
          "🔌 Kết hợp hiệu quả mạch Micro:bit (cảm biến/nút bấm/LED) với dự án Scratch",
          "🧩 Vận dụng tốt khối lệnh mở rộng Micro:bit, biến số, Broadcast & điều kiện",
          "🎮 Trải nghiệm điều khiển trò chơi bằng phần cứng trực quan, phản hồi nhạy",
          "🎨 Giao diện sân khấu, nhân vật và hiệu ứng âm thanh sinh động, cuốn hút",
          "🔧 Cần tinh chỉnh thêm độ mượt khi thao tác cảm biến liên tục ở tốc độ cao",
        ],
      };

    // =========================================================================
    // 2. GAMEMAKER (GB / GA / GI)
    // =========================================================================
    case "GAMEMAKER_BASIC":
      return {
        session12: {
          progress: [
            "✅ Đã thiết kế xong Sprites, Objects chính & bố cục màn chơi (Rooms/Tilesets)",
            "🕹️ Đã lập trình sự kiện di chuyển (Create/Step/Keyboard) cho nhân vật chính",
            "🧱 Đã thiết lập tường chắn (Solid/Collision) & tương tác cơ bản trong Room",
            "💡 Ý tưởng màn chơi 2D rõ ràng, tạo hình nhân vật và bối cảnh bắt mắt",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện thêm kẻ địch, vật phẩm, tính điểm (Score) & mạng (Lives) ở buổi 13",
            "🔊 Cần bổ sung hiệu ứng âm thanh (Sound) và màn hình Start / Game Over",
            "⏳ Tiến độ dựng Objects và sự kiện trong Room còn chậm, cần đẩy nhanh",
          ],
        },
        session13: {
          progress: [
            "✅ Đã hoàn thiện va chạm (Collision), điểm số, máu/mạng & điều kiện Thắng/Thua",
            "🗺️ Đã kết nối chuyển màn chơi (Rooms), màn hình Menu & Game Over hoàn chỉnh",
            "🔊 Đã tích hợp nhạc nền, hiệu ứng âm thanh và hoạt ảnh Sprite mượt mà",
            "🐞 Chủ động chơi thử (Playtest) và sửa lỗi kẹt tường / lệch hitbox",
          ],
          nextStep: [
            "🔧 Cần rà soát lại hitbox va chạm & cân bằng tốc độ nhân vật/kẻ địch",
            "📊 Cần chuẩn bị Slide giới thiệu cốt truyện, luật chơi & luyện thuyết trình buổi 14",
            "🎨 Cần trau chuốt thêm giao diện hiển thị điểm/máu (HUD) trên màn hình",
          ],
        },
        session14Product: [
          "🎨 Thiết kế Sprites, Tilesets và bố cục các màn chơi (Rooms) đẹp mắt, hợp lý",
          "🕹️ Vận dụng tốt hệ thống Objects, Events (Create/Step/Collision/Draw) & Alarms",
          "🎮 Cơ chế điều khiển nhân vật, tính điểm, máu và chuyển màn hoạt động mượt mà",
          "🔊 Tích hợp âm thanh, hiệu ứng hình ảnh và giao diện Menu/Game Over hoàn chỉnh",
          "🔧 Cần tinh chỉnh thêm độ cân bằng màn chơi và hitbox ở một số tình huống",
        ],
      };

    case "GAMEMAKER_GML":
      return {
        session12: {
          progress: [
            "✅ Đã xây dựng xong Sprites, Objects, Rooms & khung code GML cốt lõi",
            "💻 Đã lập trình GML cho cơ chế di chuyển, trọng lực / bắn đạn của nhân vật",
            "👾 Đã thiết lập bước đầu Object quái vật / chướng ngại vật trong màn chơi",
            "💡 Ý tưởng cơ chế gameplay 2D hấp dẫn, tổ chức tài nguyên dự án gọn gàng",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện code GML cho Spawner (Alarm), AI quái & hệ thống máu/điểm ở buổi 13",
            "🖥️ Cần bổ sung màn hình Menu, UI thanh máu (Healthbar) & hiệu ứng âm thanh",
            "⏳ Tiến độ viết script GML cho các sự kiện chính cần đẩy nhanh hơn",
          ],
        },
        session13: {
          progress: [
            "✅ Đã hoàn thiện code GML xử lý va chạm, sát thương, sinh quái (Alarm) & điểm số",
            "🖥️ Đã hoàn thành giao diện HUD (Draw GUI), chuyển Room và màn hình Thắng/Thua",
            "🐞 Chủ động debug lỗi cú pháp GML, xử lý mượt va chạm pixel/tile",
            "🔊 Đã bổ sung hiệu ứng âm thanh, hoạt ảnh tấn công và nâng cấp độ khó màn chơi",
          ],
          nextStep: [
            "🔧 Cần kiểm tra kỹ lỗi biên trong code GML & tối ưu số lượng Instance sinh ra",
            "📊 Cần hoàn thiện Slide thuyết trình & chuẩn bị kịch bản demo trực tiếp buổi 14",
            "⚖️ Cần cân chỉnh lại sát thương, tốc độ sinh quái để trải nghiệm cân bằng hơn",
          ],
        },
        session14Product: [
          "💻 Vận dụng vững vàng ngôn ngữ GML để lập trình di chuyển, va chạm & logic game",
          "🎨 Thiết kế Sprites, hoạt ảnh (Animation), Tilesets & bố cục Rooms cuốn hút",
          "🎮 Gameplay mượt mà, hệ thống quái vật (Alarm/Spawner), điểm số & HUD rõ ràng",
          "🌟 Chủ động sáng tạo thêm vũ khí, vật phẩm hỗ trợ hoặc nhiều cấp độ màn chơi",
          "🔧 Cần tối ưu thêm cấu trúc mã GML và cân bằng độ khó ở màn cuối",
        ],
      };

    case "GAMEMAKER_FSM":
      return {
        session12: {
          progress: [
            "✅ Đã thiết kế kiến trúc dự án, Sprites đa trạng thái & bản đồ Rooms/Viewports",
            "🧠 Đã xây dựng khung Máy trạng thái (FSM: Idle/Move/Attack) bằng GML",
            "🎥 Đã thiết lập Camera bám nhân vật và cơ chế điều khiển chiến đấu cơ bản",
            "💡 Ý tưởng hệ thống kỹ năng / Boss / cơ chế gameplay có chiều sâu kỹ thuật",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện trạng thái AI của Quái/Boss, hệ thống sát thương & kỹ năng ở buổi 13",
            "✨ Cần bổ sung hiệu ứng hạt (Particles/VFX), âm thanh & giao diện HUD chi tiết",
            "⏳ Tiến độ lập trình chuyển đổi trạng thái FSM cần đẩy nhanh để kịp ghép màn",
          ],
        },
        session13: {
          progress: [
            "✅ Đã hoàn thiện FSM cho cả nhân vật chính lẫn Quái/Boss, chuyển đổi hoạt ảnh mượt",
            "⚔️ Hệ thống chiến đấu, chiêu thức (Cooldown), thanh máu & Camera hoạt động ổn định",
            "🐞 Chủ động debug các lỗi kẹt trạng thái (State lock) và va chạm phức tạp",
            "🔊 Đã tích hợp đầy đủ hiệu ứng hình ảnh (VFX/Screenshake), âm thanh & đa màn chơi",
          ],
          nextStep: [
            "🔧 Cần rà soát lại độ cân bằng sát thương Boss & tối ưu hiệu năng khi nhiều hiệu ứng",
            "📊 Cần hoàn thiện Slide phân tích sơ đồ FSM & luyện thuyết trình cho buổi 14",
            "🎨 Cần trau chuốt thêm màn hình hướng dẫn phím điều khiển & tổng kết điểm",
          ],
        },
        session14Product: [
          "🧠 Áp dụng xuất sắc kiến trúc Máy trạng thái (FSM) và GML nâng cao vào dự án",
          "🎥 Thiết kế Camera/Viewports, bản đồ màn chơi & hoạt ảnh chiến đấu rất mượt mà",
          "⚔️ Cơ chế kỹ năng, AI của Quái/Boss và phản hồi va chạm có độ hoàn thiện cao",
          "🎨 Giao diện HUD, hiệu ứng hình ảnh - âm thanh và trải nghiệm người chơi cuốn hút",
          "🔧 Cần tinh chỉnh thêm độ cân bằng sát thương ở pha cuối của màn đấu Boss",
        ],
      };

    // =========================================================================
    // 3. PYTHON APP (PTB CLI vs PTA/PTI PyQt6 GUI)
    // =========================================================================
    case "PYTHON_CLI":
      return {
        session12: {
          progress: [
            "✅ Đã xây dựng khung chương trình Python, cấu trúc dữ liệu (List/Dict) & menu chính",
            "🐍 Đã lập trình được các hàm (def) xử lý chức năng cốt lõi của đề tài",
            "🔀 Đã áp dụng đúng cấu trúc điều kiện if-else và vòng lặp điều khiển luồng",
            "💡 Ý tưởng ứng dụng thực tế, cách chia tách hàm rõ ràng, dễ hiểu",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện thêm các chức năng phụ & kiểm tra dữ liệu nhập (Validate) ở buổi 13",
            "🛡️ Cần xử lý chống lỗi khi người dùng nhập sai kiểu dữ liệu (try-except / điều kiện)",
            "⏳ Tiến độ viết các hàm xử lý dữ liệu còn chậm, cần đẩy nhanh hơn",
          ],
        },
        session13: {
          progress: [
            "✅ Đã hoàn thiện trọn vẹn các chức năng trong menu, thêm/xem/tìm kiếm/tính toán chính xác",
            "🛡️ Đã bổ sung kiểm tra dữ liệu đầu vào, hạn chế lỗi văng chương trình khi chạy thử",
            "🐞 Chủ động chạy kiểm thử nhiều tình huống và tự sửa lỗi logic Python",
            "📋 Định dạng kết quả in ra màn hình rõ ràng, trực quan, dễ theo dõi",
          ],
          nextStep: [
            "🔧 Cần rà soát lại các trường hợp biên (danh sách rỗng, nhập số âm/ký tự lạ)",
            "📊 Cần hoàn thiện Slide trình bày sơ đồ luồng chương trình cho buổi 14",
            "🧹 Cần đặt lại tên biến/hàm và thêm chú thích (Comment) cho code gọn sạch hơn",
          ],
        },
        session14Product: [
          "🐍 Vận dụng vững vàng biến, kiểu dữ liệu, if-else, vòng lặp, List/Dict & hàm (def)",
          "⚙️ Chương trình chạy ổn định, các chức năng xử lý dữ liệu và tính toán chính xác",
          "🛡️ Có kiểm tra hợp lệ dữ liệu đầu vào và tổ chức luồng điều khiển mạch lạc",
          "💡 Đề tài mang tính ứng dụng thiết thực, trình bày kết quả đầu ra rõ ràng",
          "🔧 Cần mở rộng thêm tính năng lưu trữ dữ liệu hoặc tối ưu các đoạn code lặp",
        ],
      };

    case "PYTHON_GUI":
      return {
        session12: {
          progress: [
            "✅ Đã thiết kế xong các màn hình giao diện trên Qt Designer (.ui) rõ ràng, cân đối",
            "🐍 Đã xây dựng khung class OOP Python và nạp giao diện (.ui) lên cửa sổ ứng dụng",
            "🔗 Đã kết nối bước đầu Signal & Slot cho nút bấm / chuyển trang QStackedWidget",
            "💡 Ý tưởng ứng dụng thiết thực, bố cục các Widget và màu sắc QSS hài hòa",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện logic xử lý dữ liệu (.json / CRUD) & các màn hình phụ ở buổi 13",
            "💬 Cần bổ sung hộp thoại thông báo QMessageBox kiểm tra dữ liệu nhập trống/sai",
            "⏳ Tiến độ nối sự kiện code Python với file giao diện .ui cần đẩy nhanh hơn",
          ],
        },
        session13: {
          progress: [
            "✅ Đã hoàn thiện kết nối Signal & Slot, chuyển màn hình và xử lý sự kiện mượt mà",
            "💾 Đã lập trình đọc/ghi dữ liệu (.json), hiển thị danh sách & Tìm kiếm/Lọc hoạt động tốt",
            "🛡️ Đã tích hợp QMessageBox cảnh báo hợp lệ khi người dùng thao tác thiếu thông tin",
            "🐞 Chủ động chạy thử ứng dụng, tự debug lỗi crash PyQt6 và trau chuốt style QSS",
          ],
          nextStep: [
            "🔧 Cần kiểm tra kỹ các trường hợp nhập liệu đặc biệt để tránh lỗi dừng ứng dụng",
            "📊 Cần hoàn thiện Slide giới thiệu tính năng & kịch bản demo trực tiếp buổi 14",
            "🎨 Cần căn chỉnh lại kích thước chữ/nút bấm trên một số màn hình phụ cho đồng bộ",
          ],
        },
        session14Product: [
          "🖥️ Thiết kế giao diện Qt Designer (.ui) & trang trí QSS trực quan, bố cục hiện đại",
          "🧩 Vận dụng tốt lập trình hướng đối tượng (OOP), Signal & Slot và các Widget PyQt6",
          "💾 Chức năng quản lý dữ liệu (.json), Thêm/Sửa/Xóa (CRUD) & Tìm kiếm chạy chính xác",
          "🛡️ Xử lý tốt kiểm tra dữ liệu đầu vào (QMessageBox), ứng dụng vận hành ổn định",
          "🔧 Cần mở rộng thêm bộ lọc nâng cao và tối ưu cấu trúc class Python gọn hơn",
        ],
      };

    // =========================================================================
    // 4. WEB (JSB / JSA / JSI)
    // =========================================================================
    case "WEB_BASIC":
      return {
        session12: {
          progress: [
            "✅ Đã dựng xong khung HTML5 ngữ nghĩa & bố cục CSS Flexbox/Grid cho trang chủ",
            "🧭 Đã thiết kế thanh điều hướng (Navbar), Banner và liên kết giữa các trang",
            "🎨 Đã thiết kế CSS tạo phong cách màu sắc, bố cục và phông chữ hài hòa",
            "💡 Chủ đề website rõ ràng, hình ảnh minh họa và bố cục các mục hợp lý",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện thêm các trang con & tương tác JavaScript DOM ở buổi 13",
            "📐 Cần chỉnh lại khoảng cách (Padding/Margin) & hiển thị cân đối giữa các thẻ",
            "⏳ Tiến độ dàn trang HTML/CSS còn chậm, cần hoàn thiện xong các mục chính",
          ],
        },
        session13: {
          progress: [
            "✅ Đã hoàn thiện đầy đủ các trang chức năng, liên kết điều hướng hoạt động mượt",
            "⚡ Đã bổ sung tương tác JavaScript DOM (sự kiện click, form, hiệu ứng động)",
            "🎨 Giao diện CSS Flexbox/Grid đồng bộ, hình ảnh & hiệu ứng tương tác đẹp mắt",
            "🐞 Chủ động kiểm tra trên trình duyệt và sửa lỗi vỡ khung / đường dẫn ảnh",
          ],
          nextStep: [
            "🔧 Cần kiểm tra kỹ tính hợp lệ của Form nhập liệu & các nút bấm phụ trước buổi 14",
            "📊 Cần chuẩn bị Slide thuyết trình & kịch bản demo các trang web cho buổi 14",
            "🎨 Cần tinh chỉnh lại độ tương phản màu chữ ở một vài khu vực cho dễ đọc hơn",
          ],
        },
        session14Product: [
          "🎨 Giao diện website đẹp mắt, bố cục CSS Flexbox/Grid cân đối, hiện đại",
          "💻 Vận dụng tốt HTML5, CSS3 và JavaScript DOM để xây dựng các trang chức năng",
          "🧭 Luồng điều hướng đa trang mượt mà, nội dung và hình ảnh trình bày chỉn chu",
          "✨ Có hiệu ứng tương tác người dùng sinh động, thể hiện sự đầu tư nghiêm túc",
          "🔧 Cần hoàn thiện thêm khả năng co giãn (Responsive) trên nhiều kích thước màn hình",
        ],
      };

    case "WEB_JS":
      return {
        session12: {
          progress: [
            "✅ Đã hoàn thành giao diện các trang chính (HTML/CSS Flexbox/Grid) rõ ràng",
            "⚡ Đã xây dựng cấu trúc dữ liệu JavaScript (Array/Object) & hiển thị nội dung động",
            "🔗 Đã bước đầu lập trình xử lý sự kiện tương tác, biểu mẫu (Form) hoặc lưu trữ dữ liệu",
            "💡 Ý tưởng ứng dụng web thực tế, bố cục các mục và thanh điều hướng trực quan",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện các tính năng tương tác chính (Tìm kiếm / Lọc / Xử lý dữ liệu) ở buổi 13",
            "🛡️ Cần bổ sung kiểm tra dữ liệu nhập (Validate) và đồng bộ trạng thái trên giao diện",
            "⏳ Tiến độ viết hàm JavaScript xử lý sự kiện cần đẩy nhanh hơn ở buổi tới",
          ],
        },
        session13: {
          progress: [
            "✅ Đã hoàn thiện các chức năng tương tác cốt lõi và quản lý dữ liệu theo chủ đề dự án",
            "🌐 Đã tích hợp xử lý sự kiện, tìm kiếm / lọc nội dung hoặc kết nối dữ liệu mượt mà",
            "🐞 Chủ động kiểm tra trên trình duyệt và sửa các lỗi logic JavaScript ES6",
            "🎨 Giao diện cập nhật dữ liệu tức thì trên DOM, phản hồi thao tác người dùng rõ ràng",
          ],
          nextStep: [
            "🔧 Cần rà soát lại các trường hợp dữ liệu rỗng / lỗi nhập liệu trên biểu mẫu",
            "📊 Cần hoàn thiện Slide giới thiệu luồng hoạt động của web & chuẩn bị demo buổi 14",
            "🎨 Cần trau chuốt thêm giao diện các trang con & hiệu ứng chuyển trạng thái",
          ],
        },
        session14Product: [
          "🎨 Thiết kế giao diện web hiện đại, bố cục Flexbox/Grid trực quan và đồng bộ",
          "⚡ Vận dụng vững vàng JavaScript ES6, thao tác DOM và xử lý sự kiện linh hoạt",
          "💾 Xây dựng tốt luồng dữ liệu và các tính năng tương tác cốt lõi đúng chủ đề dự án",
          "🛡️ Luồng trải nghiệm người dùng mạch lạc, có kiểm tra hợp lệ dữ liệu đầu vào đầy đủ",
          "🔧 Cần tối ưu thêm việc tách hàm JavaScript và xử lý ngoại lệ khi thao tác dữ liệu",
        ],
      };

    case "WEB_FIREBASE":
      return {
        session12: {
          progress: [
            "✅ Đã dựng xong giao diện các trang chính & khởi tạo kết nối dự án Firebase",
            "🔐 Đã tích hợp bước đầu Firebase Authentication (Đăng ký / Đăng nhập tài khoản)",
            "☁️ Đã thiết kế cấu trúc Collection trên Cloud Firestore để lưu trữ dữ liệu",
            "💡 Kiến trúc ứng dụng web rõ ràng, phân chia các file module JavaScript khoa học",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện đầy đủ thao tác CRUD (Thêm/Sửa/Xóa) với Firestore ở buổi 13",
            "🤖 Cần tích hợp thêm tính năng tìm kiếm/lọc hoặc API/Chatbot phụ trợ theo đề tài",
            "⏳ Tiến độ xử lý bất đồng bộ (async/await) với Firebase cần đẩy nhanh hơn",
          ],
        },
        session13: {
          progress: [
            "✅ Đã hoàn thiện Firebase Auth & các chức năng Thêm/Sửa/Xóa/Hiển thị từ Cloud Firestore",
            "⚡ Dữ liệu đồng bộ thời gian thực lên giao diện web, phân quyền người dùng hoạt động tốt",
            "🐞 Chủ động debug lỗi bất đồng bộ (Promise/async-await) và phân quyền Firestore Rules",
            "✨ Đã tích hợp thêm tính năng nâng cao (Tìm kiếm, Upload ảnh, API hoặc Chatbot AI)",
          ],
          nextStep: [
            "🔧 Cần bổ sung hiệu ứng Loading khi chờ tải dữ liệu Cloud & kiểm tra lỗi mạng",
            "📊 Cần hoàn thiện Slide kiến trúc Firebase & kịch bản demo trực tiếp buổi 14",
            "🎨 Cần tinh chỉnh lại giao diện các hộp thoại Modal/Form nhập liệu cho mượt hơn",
          ],
        },
        session14Product: [
          "☁️ Tích hợp thành công Firebase Authentication & cơ sở dữ liệu Cloud Firestore (CRUD)",
          "⚡ Vận dụng tốt JavaScript Modules, async/await và đồng bộ dữ liệu thời gian thực",
          "🎨 Giao diện ứng dụng web hiện đại, trải nghiệm người dùng mượt mà và hoàn chỉnh",
          "🌟 Chủ động mở rộng tính năng nâng cao (tích hợp API / Chatbot AI / phân quyền)",
          "🔧 Cần tối ưu thêm xử lý trạng thái chờ (Loading) và kiểm tra dữ liệu đầu vào",
        ],
      };

    // =========================================================================
    // 5. COMPUTER SCIENCE (CSB OOP/Algo vs CSA Data/Streamlit vs CSI AI/Streamlit)
    // =========================================================================
    case "CS_ALGO":
      return {
        session12: {
          progress: [
            "✅ Đã thiết kế cấu trúc lớp (OOP Class) và mô hình hóa dữ liệu bài toán rõ ràng",
            "🔍 Đã cài đặt bước đầu thuật toán Tìm kiếm / Sắp xếp cho danh sách đối tượng",
            "📚 Đã áp dụng cấu trúc dữ liệu (List / Stack / Queue) đúng với yêu cầu đề tài",
            "💡 Tư duy thuật toán mạch lạc, phân tách module code Python có hệ thống",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện toàn bộ các chức năng Tìm kiếm, Sắp xếp đa tiêu chí ở buổi 13",
            "⚡ Cần kiểm thử với tập dữ liệu lớn hơn và tối ưu độ phức tạp thuật toán",
            "⏳ Tiến độ cài đặt các phương thức trong Class OOP cần đẩy nhanh hơn",
          ],
        },
        session13: {
          progress: [
            "✅ Đã hoàn thiện các thuật toán Tìm kiếm, Sắp xếp & cấu trúc Stack/Queue chạy chính xác",
            "🧩 Kiến trúc OOP (Kế thừa / Đóng gói) rõ ràng, đọc/ghi dữ liệu và thống kê ổn định",
            "🐞 Chủ động kiểm thử các trường hợp biên và tối ưu hiệu năng xử lý dữ liệu",
            "🖥️ Giao diện điều khiển / hiển thị kết quả trực quan, dễ đối chiếu",
          ],
          nextStep: [
            "🔧 Cần rà soát lại xử lý ngoại lệ khi tìm kiếm không thấy hoặc dữ liệu đầu vào rỗng",
            "📊 Cần chuẩn bị Slide phân tích thuật toán, độ phức tạp O(n) & kịch bản demo buổi 14",
            "🧹 Cần chuẩn hóa lại tên phương thức và chú thích thuật toán trong code",
          ],
        },
        session14Product: [
          "🧩 Thiết kế kiến trúc Hướng đối tượng (OOP) chuẩn mực, dễ bảo trì và mở rộng",
          "🔍 Vận dụng chính xác thuật toán Tìm kiếm, Sắp xếp và cấu trúc dữ liệu Stack/Queue",
          "⚡ Chương trình xử lý dữ liệu nhanh, kiểm soát tốt các trường hợp biên và ngoại lệ",
          "💡 Giải quyết bài toán thực tế một cách logic, thể hiện tư duy Khoa học máy tính vững",
          "🔧 Cần mở rộng thêm tiêu chí thống kê hoặc trực quan hóa kết quả đầu ra sinh động hơn",
        ],
      };

    case "CS_DATA_STREAMLIT":
      return {
        session12: {
          progress: [
            "✅ Đã thu thập bộ dữ liệu (.csv) phù hợp và làm sạch dữ liệu với thư viện Pandas",
            "📊 Đã thực hiện phân tích khám phá (EDA) & vẽ các biểu đồ Matplotlib/Seaborn chính",
            "🌐 Đã dựng được khung giao diện Dashboard ban đầu trên Streamlit",
            "💡 Câu hỏi phân tích dữ liệu có ý nghĩa thực tiễn, lựa chọn loại biểu đồ hợp lý",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện bộ lọc tương tác (Sidebar/Selectbox) trên Streamlit & mô hình dự đoán ở buổi 13",
            "📈 Cần bổ sung nhận xét/insight rút ra bên dưới từng biểu đồ phân tích",
            "⏳ Tiến độ xử lý giá trị khuyết (Missing values/Outliers) và lên giao diện cần đẩy nhanh",
          ],
        },
        session13: {
          progress: [
            "✅ Đã hoàn thiện quy trình tiền xử lý Pandas, hệ thống biểu đồ trực quan & số liệu thống kê",
            "🌐 Dashboard Streamlit hoạt động mượt mà với các bộ lọc tương tác & dự đoán Scikit-learn",
            "🐞 Chủ động xử lý lỗi kiểu dữ liệu cột (Data types) và tối ưu tốc độ tải trang Streamlit",
            "💡 Trình bày rõ các phát hiện (Insights) từ dữ liệu giúp người xem dễ nắm bắt",
          ],
          nextStep: [
            "🔧 Cần rà soát lại nhãn trục (Labels/Legend) trên biểu đồ cho đầy đủ và dễ đọc hơn",
            "📊 Cần hoàn thiện Slide kể chuyện bằng dữ liệu (Data Storytelling) cho buổi 14",
            "🎨 Cần sắp xếp lại bố cục các cột (`st.columns`/`st.tabs`) trên Streamlit gọn gàng hơn",
          ],
        },
        session14Product: [
          "🧹 Quy trình làm sạch, tiền xử lý và biến đổi dữ liệu bằng Pandas bài bản, chặt chẽ",
          "📊 Hệ thống biểu đồ trực quan hóa (Matplotlib/Seaborn/Plotly) đa dạng, giàu thông tin",
          "🌐 Ứng dụng Dashboard Streamlit tương tác mượt mà, tích hợp bộ lọc và mô hình dự đoán tốt",
          "💡 Rút ra được các nhận định (Data Insights) giá trị, giải quyết đúng bài toán đặt ra",
          "🔧 Cần mở rộng thêm tập dữ liệu hoặc tinh chỉnh thêm các tham số của mô hình dự báo",
        ],
      };

    case "CS_AI_STREAMLIT":
      return {
        session12: {
          progress: [
            "✅ Đã chuẩn bị xong tập dữ liệu huấn luyện & quy trình tiền xử lý (Preprocessing/Feature Engineering)",
            "🤖 Đã xây dựng và huấn luyện bước đầu mô hình Machine Learning / Deep Learning / AI",
            "🌐 Đã khởi tạo khung giao diện ứng dụng kiểm thử mô hình trên Streamlit",
            "💡 Đề tài ứng dụng AI có tính thực tiễn cao, lựa chọn thuật toán/mô hình phù hợp",
          ],
          nextStep: [
            "🔧 Cần đánh giá độ chính xác mô hình (Accuracy/F1/Loss) & ghép nối hoàn chỉnh lên Streamlit ở buổi 13",
            "⚡ Cần tinh chỉnh siêu tham số (Hyperparameters) để giảm hiện tượng quá khớp (Overfitting)",
            "⏳ Tiến độ tích hợp mô hình đã lưu (`.pkl`/`.h5`/API) vào giao diện cần đẩy nhanh hơn",
          ],
        },
        session13: {
          progress: [
            "✅ Đã huấn luyện hoàn chỉnh mô hình AI/ML kèm chỉ số đánh giá (Accuracy, Confusion Matrix) rõ ràng",
            "🌐 Đã tích hợp mô hình lên ứng dụng Streamlit, cho phép nhập dữ liệu/ảnh và trả kết quả dự đoán trực tiếp",
            "🐞 Chủ động xử lý chuẩn hóa đầu vào (Scaling/Tokenizing/Image resize) đồng nhất khi dự đoán",
            "✨ Giao diện Streamlit hiển thị trực quan độ tin cậy (Confidence/Probability) và biểu đồ phân tích",
          ],
          nextStep: [
            "🔧 Cần kiểm thử thêm các mẫu dữ liệu thực tế ngoài tập test để kiểm증 độ ổn định của AI",
            "📊 Cần hoàn thiện Slide trình bày quy trình huấn luyện, chỉ số đánh giá & demo buổi 14",
            "🎨 Cần bổ sung hướng dẫn sử dụng ngắn gọn ngay trên giao diện Streamlit cho người dùng",
          ],
        },
        session14Product: [
          "🤖 Xây dựng, huấn luyện và đánh giá mô hình AI / Machine Learning bài bản, có cơ sở khoa học",
          "🧹 Tiền xử lý dữ liệu và trích xuất đặc trưng (Feature Engineering) chuẩn xác, hợp lý",
          "🌐 Đóng gói thành công mô hình lên ứng dụng Streamlit, dự đoán thời gian thực mượt mà",
          "📊 Trực quan hóa rõ ràng kết quả thực nghiệm (Accuracy/F1-score/Biểu đồ) và ứng dụng thực tiễn",
          "🔧 Cần thu thập thêm dữ liệu đa dạng hơn để nâng cao độ chính xác với các trường hợp khó",
        ],
      };

    // =========================================================================
    // 6. ROBOTICS (VEX GO / VEX IQ / General Robotics)
    // =========================================================================
    case "ROBOTICS_VEXGO":
      return {
        session12: {
          progress: [
            "✅ Đã lắp ráp xong khung cơ khí chính của mô hình VEX GO đúng nguyên lý kỹ thuật",
            "⚙️ Đã kết nối bộ não Brain, động cơ và hệ thống bánh răng / truyền động cơ bản",
            "💻 Đã lập trình bước đầu các khối lệnh chuyển động trên VEXcode GO",
            "💡 Ý tưởng mô hình robot giải quyết nhiệm vụ sáng tạo, kết cấu bước đầu cân đối",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện lắp ráp cơ cấu phụ, tích hợp cảm biến (Eye/Bumper) & code tự hành ở buổi 13",
            "🔩 Cần gia cố lại các chốt nối (Pins/Standoffs) để mô hình không bị rung lắc khi chạy",
            "⏳ Tiến độ lắp ráp và nạp code thử nghiệm trên sa bàn cần đẩy nhanh hơn",
          ],
        },
        session13: {
          progress: [
            "✅ Đã hoàn thiện mô hình cơ khí VEX GO chắc chắn và tích hợp đầy đủ cảm biến, động cơ",
            "🤖 Đã lập trình VEXcode GO (vòng lặp, điều kiện cảm biến) giúp robot vận hành đúng kịch bản",
            "🎥 Đã chạy thực nghiệm trên sa bàn, tinh chỉnh tốc độ/góc quay và ghi hình video demo",
            "🐞 Chủ động phát hiện và khắc phục lỗi kẹt bánh răng / lệch hướng di chuyển",
          ],
          nextStep: [
            "🔧 Cần kiểm tra lại pin, dây cáp kết nối và độ ổn định cảm biến trước buổi bảo vệ 14",
            "📊 Cần hoàn thiện Slide giới thiệu cấu tạo cơ khí, nguyên lý hoạt động & luyện thuyết trình",
            "🎨 Cần trang trí hoàn thiện ngoại hình mô hình robot cho sinh động và thẩm mỹ hơn",
          ],
        },
        session14Product: [
          "🔩 Lắp ráp kết cấu cơ khí VEX GO vững chắc, vận dụng tốt truyền động bánh răng & đòn bẩy",
          "🤖 Kết hợp hiệu quả bộ não Brain, động cơ và cảm biến (Eye Sensor / Bumper / LED) trong mô hình",
          "💻 Lập trình khối lệnh VEXcode GO (sự kiện, vòng lặp, điều kiện, biến số) logic và chính xác",
          "🎯 Robot vận hành thực tế ổn định, hoàn thành tốt nhiệm vụ đề tài và có tính sáng tạo cao",
          "🔧 Cần tinh chỉnh thêm tốc độ động cơ ở các đoạn cua để robot di chuyển mượt mà hơn",
        ],
      };

    case "ROBOTICS_VEXIQ":
      return {
        session12: {
          progress: [
            "✅ Đã lắp ráp xong khung gầm Drivetrain và kết cấu cơ khí chính của robot VEX IQ",
            "🦾 Đã dựng bước đầu cơ cấu tay gắp / nâng hạ và hệ thống truyền động bánh răng",
            "💻 Đã cấu hình thiết bị (Devices) và lập trình di chuyển cơ bản trên VEXcode IQ",
            "💡 Thiết kế cơ khí có tính toán tỷ số truyền và trọng tâm robot hợp lý",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện cơ cấu chấp hành, tích hợp cảm biến (Gyro/Distance/Optical) & code tự hành ở buổi 13",
            "🔩 Cần gia cố trục truyền động và cân bằng trọng lượng khi tay gắp nâng vật nặng",
            "⏳ Tiến độ lập trình phối hợp giữa di chuyển và điều khiển cơ cấu tay gắp cần đẩy nhanh",
          ],
        },
        session13: {
          progress: [
            "✅ Đã hoàn thiện toàn bộ cơ khí VEX IQ (khung gầm, tay gắp/nâng hạ) vận hành trơn tru",
            "🤖 Đã lập trình VEXcode IQ kết hợp cảm biến giúp robot định hướng và gắp/thả vật chính xác",
            "🎥 Đã chạy thử nghiệm nhiều lượt trên sa bàn, hiệu chỉnh thông số và quay video demo",
            "🐞 Chủ động xử lý lỗi trượt bánh răng, lệch góc quay Gyro và tối ưu thời gian hoàn thành nhiệm vụ",
          ],
          nextStep: [
            "🔧 Cần kiểm tra kỹ độ bền kết cấu và hiệu chuẩn cảm biến (Calibrate) trước buổi bảo vệ 14",
            "📊 Cần hoàn thiện Slide phân tích cơ cấu cơ khí, lưu đồ thuật toán & luyện thuyết trình",
            "⚖️ Cần tinh chỉnh thêm lực kẹp và tốc độ hạ tay gắp để thao tác mượt hơn",
          ],
        },
        session14Product: [
          "🦾 Thiết kế cơ khí VEX IQ chắc chắn, tối ưu tỷ số truyền bánh răng và cơ cấu tay gắp/nâng hạ",
          "📡 Vận dụng tốt hệ thống Smart Motors và cảm biến (Gyro/Distance/Optical/Bumper) trên robot",
          "💻 Lập trình VEXcode IQ mạch lạc, điều khiển robot tự hành và thao tác nhiệm vụ chính xác",
          "🎯 Mô hình vận hành thực tế ổn định, giải quyết hiệu quả bài toán trên sa bàn thi đấu",
          "🔧 Cần tinh chỉnh thêm thuật toán giảm tốc khi tiếp cận mục tiêu để đạt độ chính xác tối đa",
        ],
      };

    case "ROBOTICS_GENERAL":
      return {
        session12: {
          progress: [
            "✅ Đã hoàn thành lắp ráp phần khung mô hình cơ khí - điện tử chính của dự án",
            "🔌 Đã kết nối bộ điều khiển trung tâm với động cơ và các cảm biến đầu vào",
            "💻 Đã lập trình kịch bản điều khiển cơ bản giúp mô hình phản hồi tín hiệu",
            "💡 Ý tưởng mô hình thực tế, bố trí linh kiện và cơ cấu truyền động hợp lý",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện toàn bộ kịch bản tự động hóa & hiệu chỉnh ngưỡng cảm biến ở buổi 13",
            "🔩 Cần cố định chắc chắn dây kết nối và khung mô hình để vận hành ổn định",
            "⏳ Tiến độ ghép nối phần cứng và lập trình điều khiển cần đẩy nhanh hơn",
          ],
        },
        session13: {
          progress: [
            "✅ Đã hoàn thiện mô hình phần cứng chắc chắn, cảm biến và cơ cấu chấp hành hoạt động đồng bộ",
            "🤖 Chương trình điều khiển xử lý đúng các điều kiện cảm biến và vận hành ổn định",
            "🎥 Đã chạy thực nghiệm thành công, tinh chỉnh thông số và ghi hình video minh chứng",
            "🐞 Chủ động kiểm tra và khắc phục lỗi nhiễu tín hiệu / kẹt cơ khí khi chạy thử",
          ],
          nextStep: [
            "🔧 Cần rà soát lại nguồn điện/pin và độ ổn định của mạch trước buổi bảo vệ 14",
            "📊 Cần hoàn thiện Slide trình bày nguyên lý hoạt động & luyện thuyết trình cho buổi 14",
            "🎨 Cần sắp xếp lại dây dẫn và hoàn thiện thẩm mỹ bên ngoài cho mô hình",
          ],
        },
        session14Product: [
          "🔩 Thiết kế và lắp ráp mô hình phần cứng / cơ khí vững chắc, bố trí linh kiện khoa học",
          "📡 Kết hợp hiệu quả hệ thống cảm biến và động cơ / cơ cấu chấp hành theo đúng đề tài",
          "💻 Lập trình thuật toán điều khiển tự động mạch lạc, phản hồi tín hiệu chính xác",
          "🎯 Sản phẩm vận hành thực nghiệm ổn định, thể hiện tư duy kỹ thuật và tính ứng dụng tốt",
          "🔧 Cần tối ưu thêm độ nhạy cảm biến khi hoạt động trong các điều kiện môi trường khác nhau",
        ],
      };

    // =========================================================================
    // 7. GENERAL FALLBACK
    // =========================================================================
    default:
      return {
        session12: {
          progress: [
            "✅ Đã hoàn thành khung giao diện / cấu trúc chính của sản phẩm cuối khóa",
            "🧩 Đã xây dựng được các tính năng cốt lõi bước đầu theo đúng chủ đề",
            "💡 Ý tưởng đề tài sáng tạo, bố cục sản phẩm rõ ràng và trực quan",
            "🚀 Nắm vững kiến thức nền tảng và chủ động triển khai dự án đúng tiến độ",
          ],
          nextStep: [
            "🔧 Cần hoàn thiện tiếp các tính năng chi tiết và luồng xử lý chính ở buổi 13",
            "🎨 Cần bổ sung thêm dữ liệu, hình ảnh và trau chuốt giao diện/mô hình",
            "⏳ Tiến độ triển khai còn hơi chậm, cần tập trung đẩy nhanh ở buổi tiếp theo",
          ],
        },
        session13: {
          progress: [
            "✅ Đã hoàn thiện các chức năng chính, sản phẩm vận hành ổn định và đúng luồng",
            "🐞 Chủ động chạy thử nghiệm, phát hiện và xử lý tốt các lỗi phát sinh",
            "🎨 Đã cập nhật giao diện / mô hình trực quan, trải nghiệm sử dụng mượt mà",
            "✨ Bổ sung thêm các chi tiết mở rộng giúp sản phẩm hoàn chỉnh hơn",
          ],
          nextStep: [
            "🔧 Cần rà soát lại các lỗi nhỏ ở trường hợp biên để sản phẩm mượt mà nhất",
            "📊 Cần hoàn thiện Slide thuyết trình và luyện tập trình bày cho buổi 14",
            "🎨 Cần tinh chỉnh lại một vài chi tiết hiển thị cho đồng bộ trước khi bảo vệ",
          ],
        },
        session14Product: [
          "🏆 Hoàn thành tốt sản phẩm cuối khóa với đầy đủ các chức năng theo yêu cầu",
          "🎨 Thiết kế giao diện / mô hình trực quan, bố cục hài hòa và chỉn chu",
          "🧩 Vận dụng vững vàng các kiến thức lập trình & công nghệ đã học trong khóa",
          "🌟 Ý tưởng sáng tạo, chủ động tìm tòi và xử lý lỗi tốt trong suốt dự án",
          "🔧 Cần trau chuốt thêm một số chi tiết nhỏ và tối ưu code/cấu trúc gọn hơn",
        ],
      };
  }
}

const ALL_COURSE_PREFIXES_FOR_SETS = [
  "SB",
  "SA",
  "SI",
  "GB",
  "GA",
  "GI",
  "PTB",
  "PTA",
  "PTI",
  "JSB",
  "JSA",
  "JSI",
  "CSB",
  "CSA",
  "CSI",
  "PREB",
  "PREA",
  "PREI",
  "ARMB",
  "ARMA",
  "ARMI",
  "SEMIB",
  "SEMIA",
  "SEMII",
  "ROB",
  "GENERAL",
];

const CANONICAL_PRESENTATION_TAGS_SET = new Set<string>([
  ...SESSION_14_PRESENTATION_TAGS,
  ...OPTIONAL_SESSION_12_13_PRESENTATION_TAGS,
]);

const LEGACY_WEB_PROGRESS_AND_PRODUCT_TAGS: string[] = [
  "🎨 Đã áp dụng Bootstrap / CSS tạo phong cách màu sắc, phông chữ hài hòa",
  "🎨 Giao diện Flexbox/Grid/Bootstrap đồng bộ, hình ảnh & hiệu ứng hover đẹp mắt",
  "🎨 Giao diện website đẹp mắt, bố cục CSS Flexbox/Grid & Bootstrap cân đối, hiện đại",
  "⚡ Đã xây dựng cấu trúc dữ liệu JavaScript (Array/Object) & render danh sách động",
  "🔐 Đã bước đầu lập trình chức năng Đăng nhập / Đăng ký hoặc lưu LocalStorage",
  "💡 Ý tưởng ứng dụng web thực tế, bố cục sản phẩm và thanh công cụ trực quan",
  "✅ Đã hoàn thiện chức năng Đăng nhập/Đăng ký, Giỏ hàng / Quản lý dữ liệu với LocalStorage",
  "🌐 Đã tích hợp Fetch API / tìm kiếm & lọc danh sách sản phẩm theo từ khóa mượt mà",
  "🐞 Chủ động kiểm tra DevTools Console và sửa các lỗi logic JavaScript ES6",
  "🎨 Giao diện cập nhật dữ liệu tức thì trên DOM, thông báo trạng thái rõ ràng",
  "💾 Tích hợp hiệu quả LocalStorage / Fetch API cho Đăng nhập, Giỏ hàng & Tìm kiếm",
  "🛡️ Luồng trải nghiệm người dùng mạch lạc, có kiểm tra hợp lệ dữ liệu Form đầy đủ",
];

const LEGACY_WEB_LIMITATION_TAGS: string[] = [
  "🔧 Cần hoàn thiện luồng Giỏ hàng / Tìm kiếm / Lọc dữ liệu & Fetch API ở buổi 13",
  "🛡️ Cần bổ sung kiểm tra dữ liệu Form (Validate) và đồng bộ trạng thái LocalStorage",
  "🔧 Cần rà soát lại các trường hợp dữ liệu rỗng trong LocalStorage / lỗi nhập Form",
  "📊 Cần hoàn thiện Slide giới thiệu luồng dữ liệu JS & chuẩn bị demo buổi 14",
  "🎨 Cần trau chuốt thêm giao diện trang chi tiết sản phẩm & hiệu ứng chuyển trạng thái",
  "🔧 Cần tối ưu thêm việc tách hàm JavaScript và xử lý ngoại lệ khi tải dữ liệu",
];

const CANONICAL_LIMITATION_TAGS_SET = new Set<string>([
  "⚠️ Thuyết trình còn rụt rè, cần rèn thêm sự tự tin",
  "⚠️ Phần trình bày thử còn ngập ngừng, cần luyện nói lưu loát hơn",
  ...LEGACY_WEB_LIMITATION_TAGS,
]);

const CANONICAL_ALL_TAGS_SET = new Set<string>([
  ...SESSION_14_PRESENTATION_TAGS,
  ...OPTIONAL_SESSION_12_13_PRESENTATION_TAGS,
  ...LEGACY_WEB_PROGRESS_AND_PRODUCT_TAGS,
  ...LEGACY_WEB_LIMITATION_TAGS,
]);

for (const prefix of ALL_COURSE_PREFIXES_FOR_SETS) {
  const profile = detectSpckCourseProfile(prefix === "GENERAL" ? "" : prefix, "", []);
  const cfg = getSubTrackTagConfig(profile);
  for (const t of cfg.session12.progress) CANONICAL_ALL_TAGS_SET.add(t);
  for (const t of cfg.session12.nextStep) {
    CANONICAL_ALL_TAGS_SET.add(t);
    CANONICAL_LIMITATION_TAGS_SET.add(t);
  }
  for (const t of cfg.session13.progress) CANONICAL_ALL_TAGS_SET.add(t);
  for (const t of cfg.session13.nextStep) {
    CANONICAL_ALL_TAGS_SET.add(t);
    CANONICAL_LIMITATION_TAGS_SET.add(t);
  }
  for (const t of cfg.session14Product) {
    CANONICAL_ALL_TAGS_SET.add(t);
    if (/^🔧/u.test(t)) {
      CANONICAL_LIMITATION_TAGS_SET.add(t);
    }
  }
}

/**
 * Checks whether a tag string is one of the canonical SPCK Quick Tags.
 */
export function isCanonicalSpckQuickTag(tagLabel: string): boolean {
  const norm = String(tagLabel || "").trim();
  if (!norm) return false;
  return CANONICAL_ALL_TAGS_SET.has(norm);
}

/**
 * Checks whether a Quick Tag belongs to the Presentation & Slide evaluation group.
 */
export function isPresentationQuickTag(tagLabel: string): boolean {
  const norm = String(tagLabel || "").trim();
  if (!norm) return false;
  if (CANONICAL_PRESENTATION_TAGS_SET.has(norm)) {
    return true;
  }
  if (CANONICAL_ALL_TAGS_SET.has(norm)) {
    return false;
  }
  if (
    /(?:cần\s+(?:hoàn\s*thiện|chuẩn\s*bị|bổ\s*sung|luyện\s*tập).*slide|(?:slide|thuyết\s*trình|trình\s*bày).*\bcho\s+buổi\s*14\b|trình\s*bày\s+(?:kết\s*quả|rõ\s*các\s*phát\s*hiện|nội\s*dung|hình\s*ảnh|chỉn\s*chu|báo\s*cáo)|hình\s*ảnh\s*trình\s*bày)/i.test(
      norm
    )
  ) {
    return false;
  }
  return /(thuyết\s*trình|trình\s*bày|slide|phản\s*biện|tự\s*tin\s*trước\s*lớp|giọng\s*nói\s*to\s*rõ)/i.test(
    norm
  );
}

/**
 * Checks whether a Quick Tag indicates a next-step / limitation / improvement area.
 */
export function isLimitationOrNextStepQuickTag(tagLabel: string): boolean {
  const norm = String(tagLabel || "").trim();
  if (!norm) return false;
  if (CANONICAL_LIMITATION_TAGS_SET.has(norm)) {
    return true;
  }
  if (CANONICAL_ALL_TAGS_SET.has(norm)) {
    return false;
  }
  if (
    /(cần\s+(hoàn\s*thiện|bổ\s*sung|trau\s*chuốt|tinh\s*chỉnh|tối\s*ưu|rà\s*soát|kiểm\s*tra|kiểm\s*thử|chuẩn\s*bị|căn\s*chỉnh|cân\s*chỉnh|gia\s*cố|cố\s*định|mở\s*rộng|cân\s*bằng|rèn\s*thêm|đẩy\s*nhanh|xử\s*lý|tích\s*hợp|đặt\s*lại|chuẩn\s*hóa|sắp\s*xếp|đánh\s*giá|thu\s*thập|trang\s*trí|chỉnh\s*lại)|tiến\s*độ.*(chậm|đẩy\s*nhanh)|còn\s+(rụt\s*rè|ngập\s*ngừng|thiếu|chậm|lỗi))/i.test(
      norm
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Builds the 2-row grouped Quick Tags for a given class, course, and SPCK session (12, 13, or 14).
 */
export function getSpckQuickTagGroups(params: {
  classId?: string | null;
  courseName?: string | null;
  sessionNumber: 12 | 13 | 14;
  customSession14Tags?: string[];
  fileExtensions?: string[];
}): SpckSessionQuickTagsBundle {
  const profile = detectSpckCourseProfile(
    params.classId,
    params.courseName,
    params.fileExtensions
  );
  const cfg = getSubTrackTagConfig(profile);
  const sessionNumber = params.sessionNumber;

  if (sessionNumber === 14) {
    // Merge any custom presentation tags configured in quick_tags.json without duplicating
    const customPresTags: string[] = [];
    const customProdTags: string[] = [];
    if (Array.isArray(params.customSession14Tags)) {
      for (const rawTag of params.customSession14Tags) {
        const clean = String(rawTag || "").trim();
        if (!clean) continue;
        if (isPresentationQuickTag(clean)) {
          if (
            !SESSION_14_PRESENTATION_TAGS.some(
              (t) => t.toLowerCase().includes(clean.toLowerCase()) || clean.toLowerCase().includes(t.replace(/^[^\wÀ-ỹ]+\s*/, "").toLowerCase())
            )
          ) {
            customPresTags.push(clean);
          }
        } else if (
          !cfg.session14Product.includes(clean) &&
          // Skip old generic web/course-agnostic tags so subject-specific tags stay clean
          !/^(Slide đẹp|Trình bày tốt|Hoàn thành tốt sản phẩm cuối khóa|Ý tưởng sáng tạo, giao diện trực quan|Vận dụng vững kiến thức lập trình đã học|Chủ động tìm tòi, xử lý lỗi tốt|Cần trau chuốt thêm phần giao diện và tối ưu code|Thuyết trình tự tin, trình bày rõ ràng mạch lạc)$/i.test(
            clean
          )
        ) {
          customProdTags.push(clean);
        }
      }
    }

    const presGroup: SpckQuickTagGroup = {
      id: "presentation",
      title: "🎤 1. Về phần thuyết trình & Slide (chọn để AI nhận xét phần 1)",
      tone: "violet",
      tags: [...SESSION_14_PRESENTATION_TAGS, ...customPresTags],
    };

    const prodGroup: SpckQuickTagGroup = {
      id: "product",
      title: `🏆 2. Về sản phẩm cuối khóa — ${profile.trackBadgeLabel}`,
      tone: "indigo",
      tags: [...cfg.session14Product, ...customProdTags],
    };

    return {
      profile,
      sessionNumber: 14,
      groups: [presGroup, prodGroup],
      allAvailableTags: [...presGroup.tags, ...prodGroup.tags],
    };
  }

  const stageTags = sessionNumber === 12 ? cfg.session12 : cfg.session13;
  const progressGroup: SpckQuickTagGroup = {
    id: "progress",
    title: `🟢 Tiến độ & Phần đã làm được (Buổi ${sessionNumber} — ${profile.trackBadgeLabel})`,
    tone: "emerald",
    tags: stageTags.progress,
  };
  const nextStepGroup: SpckQuickTagGroup = {
    id: "next_step",
    title: `🟠 Phần cần hoàn thiện tiếp theo (chọn 1 thẻ định hướng Buổi ${sessionNumber === 12 ? 13 : 14})`,
    tone: "amber",
    tags: stageTags.nextStep,
  };
  const optionalPresentationGroup: SpckQuickTagGroup = {
    id: "presentation",
    title: `🎤 Kỹ năng thuyết trình thử (Buổi ${sessionNumber})`,
    tone: "violet",
    tags: OPTIONAL_SESSION_12_13_PRESENTATION_TAGS,
  };

  return {
    profile,
    sessionNumber,
    groups: [progressGroup, nextStepGroup],
    optionalPresentationGroup,
    allAvailableTags: [
      ...progressGroup.tags,
      ...nextStepGroup.tags,
      ...optionalPresentationGroup.tags,
    ],
  };
}

export interface SpckAutoSuggestInput {
  classId?: string | null;
  courseName?: string | null;
  sessionNumber: 12 | 13 | 14;
  fileExtensions?: string[];
  screenshotCount?: number;
  attachmentCount?: number;
  youtubeCount?: number;
  slideCount?: number;
  hasFlexOrGridCss?: boolean;
  hasNavLinks?: boolean;
  hasEventBinding?: boolean;
  hasDomUpdate?: boolean;
  hasJsInteraction?: boolean;
  hasFirebaseCode?: boolean;
  hasRoboticsCode?: boolean;
}

/**
 * Automatically suggests strictly factual, single-claim observation tags when a student's
 * project folder has verified code/media evidence. Never auto-suggests multi-conclusion
 * evaluation tags, completion/quality judgments, working connection claims, or hardware quality.
 */
export function suggestSpckQuickTagsFromProject(
  input: SpckAutoSuggestInput
): string[] {
  // Session 14 summative evaluation tags always require explicit teacher selection
  if (input.sessionNumber === 14) {
    return [];
  }

  const normalizedExts = Array.isArray(input.fileExtensions)
    ? input.fileExtensions
        .map((e) => String(e || "").trim().toLowerCase())
        .filter(Boolean)
    : [];
  const hasPhotos = (input.screenshotCount || 0) > 0;
  const hasVideos = (input.youtubeCount || 0) > 0;

  const bundle = getSpckQuickTagGroups({
    classId: input.classId,
    courseName: input.courseName,
    sessionNumber: input.sessionNumber,
    fileExtensions: normalizedExts,
  });

  const suggested: string[] = [];

  if (bundle.profile.track === "WEB") {
    if (input.hasFlexOrGridCss) {
      suggested.push("📐 Có sử dụng bố cục CSS Flexbox/Grid");
    }
    if (input.hasNavLinks) {
      suggested.push("🧭 Có phần tử điều hướng (<nav>) chứa liên kết");
    }
    if (input.hasEventBinding) {
      suggested.push("🖱️ Có gắn sự kiện tương tác (Event Listener)");
    }
    if (input.hasDomUpdate) {
      suggested.push("🔄 Có thao tác cập nhật nội dung phần tử DOM");
    }
    if (input.hasJsInteraction && !input.hasEventBinding && !input.hasDomUpdate) {
      suggested.push("🖱️ Có gắn sự kiện tương tác và cập nhật phần tử DOM");
    }
    if (input.hasFirebaseCode) {
      suggested.push("🔥 Có khai báo thư viện / cấu hình Firebase trong mã nguồn");
    }
    return suggested;
  }

  if (bundle.profile.track === "ROBOTICS") {
    const hasRoboticsCode = Boolean(input.hasRoboticsCode);

    if (!hasRoboticsCode && !hasVideos) {
      return [];
    }

    if (hasRoboticsCode) {
      suggested.push("🤖 Có tệp chương trình điều khiển robot trong thư mục dự án");
      if (hasPhotos) {
        suggested.push("📷 Có hình ảnh chụp mô hình sản phẩm trong thư mục");
      }
    }
    if (hasVideos) {
      suggested.push("🎥 Có đường dẫn video ghi hình sản phẩm");
    }
    return suggested;
  }

  return [];
}

