# ND2 Radiology OS V5.5 — Khoa CĐHA, BV Nhi Đồng 2

Bản phát hành **5.5.3** · trạng thái: **đã kiểm thử cục bộ trên nhánh `staging`, CHƯA triển khai** (chờ chủ sở hữu duyệt).

Ứng dụng một file HTML (Netlify) + Google Apps Script (API) + Google Sheets (dữ liệu).

## Cấu trúc thư mục

| Thư mục | Nội dung |
|---|---|
| `05_FRONTEND_V5.5/` | **Bản triển khai frontend**: `index.html`, `config.js`. Netlify chỉ xuất bản thư mục này. |
| `04_BACKEND_V5.5/` | **Bản triển khai backend**: `Code.gs` (dán vào Apps Script), `appsscript.json` (tham khảo). |
| `06_MIGRATION/` | `STAGING_RUNBOOK.md`, `PRODUCTION_CUTOVER_CHECKLIST.md`, `ROLLBACK_PLAN.md`. |
| `07_TESTING/` | Bộ kiểm thử chạy trong trình duyệt (không cần Node): `backend.html`, `e2e.html`. |
| `08_DOCUMENTATION/` | `CHANGELOG.md`, `KNOWN_ISSUES.md`, `API_CONTRACTS.md`, `PERMISSION_MATRIX.md`, `AI_HANDOFF.md`. |
| `03_DATABASE_SCHEMA/` | `SCHEMA.md` — các sheet, cột, cấu trúc bản ghi. |
| `01_BACKUP_V5/`, `02_SOURCE_CODE/` | Bản sao đối chiếu (đã kiểm mã băm) của V5 và bản nháp V5.5 như đã nhận. Không sửa. |
| `5.0/`, `5.5/` | Kho lưu của chủ sở hữu: nguồn V5 và bản nháp V5.5 gốc. Không sửa, không triển khai. |
| `scripts/write-config.sh`, `netlify.toml` | Cấu hình build Netlify (ghi `config.js` theo môi trường). |

> Lưu ý: file triển khai là `05_FRONTEND_V5.5/index.html` và `04_BACKEND_V5.5/Code.gs`.
> `5.5/index.html` và `5.5/code.gs` là **bản nháp 5.5.0 gốc** — còn các lỗi đã liệt kê trong CHANGELOG.

## Nhánh git

- `main` — baseline như đã nhận. Chỉ nhận V5.5 khi chủ sở hữu duyệt.
- `staging` — bản 5.5.3 cùng test và tài liệu.

## Chạy kiểm thử (máy Windows, chỉ cần Python)

```bash
python -m http.server 8055 --bind 127.0.0.1
```

Mở trong Chrome:

- `http://localhost:8055/07_TESTING/backend.html` — 70 test backend
- `http://localhost:8055/07_TESTING/e2e.html` — 52 test đầu-cuối
- `http://localhost:8055/05_FRONTEND_V5.5/index.html` — dùng thử ứng dụng ở chế độ cục bộ

Test chạy `Code.gs` thật trên Apps Script **giả lập**; không gọi Google hay DeepSeek, không chạm dữ liệu thật.

## Triển khai

1. Staging: làm theo `06_MIGRATION/STAGING_RUNBOOK.md`.
2. Production: chỉ sau khi staging đạt và chủ sở hữu duyệt — `06_MIGRATION/PRODUCTION_CUTOVER_CHECKLIST.md`.
3. Sự cố: `06_MIGRATION/ROLLBACK_PLAN.md`.

## An toàn production

Chưa có lời gọi nào tới Google Sheets, Apps Script hay Netlify production trong quá trình xây dựng bản này.
Quy tắc dự án: `5.5/ND2_V5.5_Claude_Code_Engineering_Handbook.md`.
