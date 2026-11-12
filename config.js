/* Cấu hình theo bản triển khai — KHÔNG chứa bí mật (địa chỉ Web App vốn hiển thị trong trình duyệt).
 *
 *   apiUrl  Địa chỉ Web App Google Apps Script (…/exec). Để trống = mỗi máy tự nhập ở
 *           màn hình đăng nhập → "⚙️ Cấu hình máy chủ", hoặc chạy ở chế độ cục bộ.
 *   env     'staging' | 'production'. Khác 'production' thì giao diện hiện nhãn môi trường.
 *
 * Khi deploy bằng Netlify nối Git, file này được GHI ĐÈ lúc build bởi scripts/write-config.sh
 * từ biến môi trường ND2_API_URL (đặt riêng cho từng context: Production / Branch deploys).
 * Nhờ vậy nhánh staging và main không bao giờ dùng lẫn máy chủ của nhau.
 */
window.ND2_CONFIG = window.ND2_CONFIG || { apiUrl: '', env: '' };
