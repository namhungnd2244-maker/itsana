# ITSANA Radiology OS (V5.5)

**Hệ điều hành Khoa Chẩn đoán hình ảnh** — Giải pháp quản trị tổng thể dành cho Bệnh viện Nhi Đồng 2, tối ưu hóa quy trình làm việc, quản lý nhân sự, thiết bị và tích hợp trí tuệ nhân tạo (AI).

Dự án được thiết kế theo kiến trúc **Single HTML Application** (giao diện chạy trên một file duy nhất) kết hợp với **Google Apps Script** làm Backend/API Gateway và **Google Sheets** làm Cơ sở dữ liệu vận hành.

---

## 🚀 Tính năng nổi bật (Bản V5.5)

- **Quản trị Nhân lực (Workforce-first):** Quản lý hồ sơ, lịch trực, nghỉ phép (quy trình duyệt 2 cấp), đánh giá năng lực và kế cận.
- **Quản lý Chuyên môn & Vận hành:** Báo cáo sản lượng, thống kê ca trực, quản lý trang thiết bị và vật tư y tế.
- **An toàn Bức xạ & Chất lượng:** Quản lý liều kế, kiểm định thiết bị X-quang, sổ rủi ro và sự cố y khoa.
- **Trợ lý AI (DeepSeek):** Tích hợp AI hỗ trợ tra cứu, tóm tắt với **PII Gate** (tự động chặn thông tin định danh bệnh nhân trước khi gửi lên Cloud).
- **Bảo mật & Tuân thủ:** Xác thực HMAC-SHA256, phân quyền RBAC, nhật ký thao tác (Audit Log) có mã hóa chuỗi, hướng tới tiêu chuẩn JCI.
- **Đồng bộ hóa:** Cơ chế LocalStorage-first, tự động đồng bộ với Google Sheets.

---

## 🛠 Kiến trúc Công nghệ

- **Frontend:** HTML5, Vanilla JavaScript, CSS3 (Không phụ thuộc thư viện ngoài).
- **Backend:** Google Apps Script (`Code.gs` v5.5.0).
- **Database:** Google Sheets.
- **AI Integration:** DeepSeek API (Có thể mở rộng Gemini).

---

## 📁 Cấu trúc Thư mục Dự án

```text
itsana/
├── index.html                  # Giao diện chính (Frontend SPA)
├── manifest.json               # PWA Manifest
├── sw.js                       # Service Worker (Hỗ trợ offline)
├── backend/
│   └── Code.gs                 # Mã nguồn Google Apps Script Backend
├── docs/
│   └── architecture/           # 15 tài liệu thiết kế kiến trúc (Phase 1)
└── README.md                   # Tài liệu hướng dẫn này