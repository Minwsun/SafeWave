# HƯỚNG DẪN SỬ DỤNG DATABASE TRONG SAFEWAVE

## Tổng quan

SafeWave đã được tích hợp SQLite database để lưu trữ dữ liệu vĩnh viễn. Database được lưu tại:
- **Windows**: `%APPDATA%/safewave/safewave.db`
- **macOS**: `~/Library/Application Support/safewave/safewave.db`
- **Linux**: `~/.config/safewave/safewave.db`

## Cài đặt

1. **Cài đặt dependencies**:
```bash
npm install
```

2. **Database sẽ tự động được tạo** khi ứng dụng chạy lần đầu.

## Cấu trúc Database

### Các bảng chính:
- `locations`: Lưu thông tin vị trí đã phân tích
- `weather_records`: Lưu dữ liệu thời tiết
- `rain_stats`: Lưu thống kê mưa
- `risk_analyses`: Lưu kết quả phân tích rủi ro
- `risk_reasons`: Lưu các lý do rủi ro chi tiết
- `alerts`: Lưu cảnh báo thiên tai
- `analysis_history`: Lưu lịch sử phân tích

## Tính năng

### 1. Tự động lưu phân tích
- Khi bạn click vào một vị trí trên bản đồ và có kết quả phân tích, hệ thống sẽ tự động lưu:
  - Thông tin vị trí
  - Dữ liệu thời tiết
  - Kết quả phân tích rủi ro
  - Các lý do rủi ro chi tiết

### 2. Lịch sử phân tích
- Lịch sử được load từ database khi ứng dụng khởi động
- Tự động lưu khi có phân tích với mức rủi ro >= 2
- Tự động xóa dữ liệu cũ hơn 10 ngày

### 3. Lưu cảnh báo
- Các cảnh báo từ GDACS được lưu vào database
- Có thể truy vấn lại các cảnh báo đã lưu

## API sử dụng

### Trong Frontend (TypeScript):
```typescript
import { dbService } from './services/dbService';

// Lưu phân tích
await dbService.saveAnalysis(location, weatherData, rainStats, analysis, reasons);

// Lấy lịch sử
const history = await dbService.getHistory(100);

// Lưu cảnh báo
await dbService.saveAlert(alertData);

// Lấy cảnh báo
const alerts = await dbService.getAlerts();
```

### Trong Electron Main Process:
```javascript
const SafeWaveDB = require('./database/db');
const db = new SafeWaveDB();

// Sử dụng các method của db
db.saveCompleteAnalysis(...);
db.getHistory(100);
```

## Lưu ý

1. **Database tự động được tạo** khi ứng dụng chạy lần đầu
2. **Dữ liệu được lưu vĩnh viễn** - không mất khi đóng app
3. **Tự động cleanup**: Dữ liệu cũ hơn 10 ngày sẽ bị xóa khi khởi động app
4. **Fallback**: Nếu database không khả dụng, ứng dụng vẫn hoạt động với state management như cũ

## Troubleshooting

### Database không hoạt động?
- Kiểm tra xem `better-sqlite3` đã được cài đặt chưa: `npm install better-sqlite3`
- Kiểm tra quyền ghi vào thư mục user data
- Xem console log để biết lỗi cụ thể

### Xóa database để reset?
- Đóng ứng dụng
- Xóa file `safewave.db` trong thư mục user data
- Khởi động lại ứng dụng - database sẽ được tạo mới

## Migration từ version cũ

Nếu bạn đang dùng version cũ không có database:
- Không cần làm gì - database sẽ tự động được tạo
- Lịch sử cũ trong memory sẽ mất, nhưng các phân tích mới sẽ được lưu

