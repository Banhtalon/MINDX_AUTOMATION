/**
 * MINDX AUTOMATION BOT - SELECTORS REPOSITORY
 * Centralized CSS and XPath selectors for MindX LMS and Teaching systems.
 */

export const SELECTORS = {
  // 1. Authentications
  auth: {
    teaching: {
      emailInput: 'input[name="email"], input[type="email"], input[placeholder*="email" i]',
      passwordInput: 'input[name="password"], input[type="password"]',
      submitButton: 'button[type="submit"], button:has-text("Đăng nhập"), button:has-text("Login")',
      loggedInIndicator: '.user-avatar, .user-profile, button:has-text("Đăng xuất"), a[href*="logout"]',
    },
    lms: {
      usernameInput: 'input[name="username"], input[name="email"], input[placeholder*="tài khoản" i], input[placeholder*="email" i]',
      passwordInput: 'input[name="password"], input[type="password"]',
      submitButton: 'button[type="submit"], button:has-text("Đăng nhập"), button:has-text("Login")',
      loggedInIndicator: '.avatar, .header-user, .user-name, [data-testid="user-profile"], button:has-text("Đăng xuất")',
    },
  },

  // 2. Class List & Navigation
  classes: {
    searchInput: 'input[placeholder*="Tìm kiếm" i], input[placeholder*="mã lớp" i]',
    tableRow: 'table tbody tr, .class-card, [data-testid="class-row"]',
    rowByClassCode: (code: string) => `tr:has-text("${code}"), .class-card:has-text("${code}")`,
    drawer: '.ant-drawer, .slide-over, [role="dialog"], .drawer-content',
    drawerTitle: '.ant-drawer-title, .drawer-header, h2, h3',
    closeDrawerButton: '.ant-drawer-close, button[aria-label="Close"], button:has-text("✕")',
  },

  // 3. Tabs in Drawer
  tabs: {
    general: 'button[role="tab"]:has-text("Thông tin chung"), .tab-item:has-text("Thông tin chung")',
    schedule: 'button[role="tab"]:has-text("Lịch học"), .tab-item:has-text("Lịch học")',
    homework: 'button[role="tab"]:has-text("Bài tập về nhà"), .tab-item:has-text("Bài tập về nhà")',
    grading: 'button[role="tab"]:has-text("Chấm bài"), .tab-item:has-text("Chấm bài")',
    students: 'button[role="tab"]:has-text("Học viên"), .tab-item:has-text("Học viên")',
    spck: 'button[role="tab"]:has-text("Sản phẩm cuối khóa"), button[role="tab"]:has-text("SPCK"), .tab-item:has-text("SPCK")',
    nextTabArrow: '.ant-tabs-nav-more, button[aria-label="next-tab"], .tab-scroll-right',
  },

  // 4. Students Tab & Pagination
  students: {
    table: 'table',
    tableRows: 'table tbody tr',
    rowByStudentName: (name: string) => `table tbody tr:has-text("${name}")`,
    activeSwitch: '.ant-switch, input[type="checkbox"].status-toggle, [role="switch"]',
    activeSwitchChecked: '.ant-switch-checked, [role="switch"][aria-checked="true"]',
    pageSizeSelect: '.ant-pagination-options-size-changer, select.page-size, .pagination-selector',
    paginationNext: '.ant-pagination-next:not(.ant-pagination-disabled), button[aria-label="Next Page"]',
    paginationTotal: '.ant-pagination-total-text, .pagination-count',
  },

  // 5. Grading Tab & Modal
  grading: {
    table: 'table',
    columnHeader: 'table thead th',
    gradeCell: 'table tbody tr td',
    openModalButton: 'button:has-text("Chỉnh sửa"), button:has-text("Chấm điểm"), .btn-grade',
    modal: {
      container: '.ant-modal, [role="dialog"].grade-modal',
      title: '.ant-modal-title, .modal-header h3',
      submissionFileLink: '.submission-file a, a[download], a[href*="download"]',
      downloadButton: 'button[title*="Tải về" i], .anticon-download, button:has(.anticon-download)',
      radioGrade: 'input[type="radio"][value="grade"], label:has-text("Chấm điểm") input',
      radioRedo: 'input[type="radio"][value="redo"], label:has-text("Yêu cầu học sinh làm lại") input',
      scoreInput: 'input[type="number"], input[placeholder*="Điểm" i], .score-input input',
      richTextEditor: '.ck-content, [contenteditable="true"], textarea[placeholder*="nhận xét" i], .ant-input',
      cancelButton: 'button:has-text("Thoát"), button:has-text("Hủy")',
      saveButton: 'button:has-text("Lưu"), button[type="submit"]:has-text("Lưu")',
    },
  },

  // 6. Session Feedback
  sessionComments: {
    container: '.session-feedback-container, .attendance-comments',
    commentRow: (studentId: string) => `[data-student-id="${studentId}"], tr:has-text("${studentId}")`,
    richTextEditor: '.ck-content, [contenteditable="true"], textarea',
    saveButton: 'button:has-text("Lưu nhận xét"), button:has-text("Lưu")',
  },

  // 7. SPCK Upload Form
  spck: {
    container: '.spck-container, .final-project-section',
    spckItem01: '.spck-item, .ant-card:has-text("Sản Phẩm Học Viên 01")',
    addSpckButton: 'button:has-text("+ Thêm sản phẩm học viên"), button:has-text("Thêm sản phẩm")',
    titleInput: 'input[placeholder*="Tiêu đề" i], input[name="title"]',
    youtubeInput: 'input[placeholder*="youtube" i], input[placeholder*="Đường dẫn youtube" i]',
    addYoutubeButton: 'button:has-text("+ Thêm"):near(input[placeholder*="youtube" i]), button:has-text("Thêm video")',
    thumbnailUploadButton: 'button:has-text("+ Thay ảnh"), .thumbnail-uploader input[type="file"]',
    imageDropzone: '.image-dropzone, .ant-upload-drag:has-text("hình ảnh")',
    imageFileInput: '.image-dropzone input[type="file"], .ant-upload input[accept*="image"]',
    attachmentDropzone: '.attachment-dropzone, .ant-upload-drag:has-text("Tài liệu")',
    attachmentFileInput: '.attachment-dropzone input[type="file"], .ant-upload input:not([accept*="image"])',
    linkNameInput: 'input[placeholder*="Đặt tên đường dẫn" i]',
    linkUrlInput: 'input[placeholder*="Nhập đường dẫn" i]',
    addLinkButton: 'button:has-text("+ Thêm"):near(input[placeholder*="đường dẫn" i])',
    teacherCommentTextarea: 'textarea[placeholder*="Bình luận" i], textarea[name="teacherComment"]',
    saveButton: 'button:has-text("Lưu"):visible',
  },

  // 8. Common UI Elements
  common: {
    loadingSpinner: '.ant-spin-spinning, .spinner, .loading',
    toastForbidden: '.ant-notification-notice-error:has-text("Forbidden"), .toast-error:has-text("Forbidden"), .Forbidden',
    toastCloseButton: '.ant-notification-notice-close, button.toast-close',
    generalToast: '.ant-message, .ant-notification-notice, .toast',
  },
};
