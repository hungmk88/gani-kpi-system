# Tài liệu API — GANI FOODY KPI System

Toàn bộ endpoint đặt dưới `/api`. Trừ webhook và cron, mọi endpoint đều yêu cầu cookie phiên đăng nhập (`gani_kpi_session`, HttpOnly).

## Định dạng lỗi chung

```json
{
  "statusCode": 403,
  "errorCode": "CROSS_DEPT_ASSIGNMENT_FORBIDDEN",
  "message": "Trưởng phòng không được phép giao việc trực tiếp cho phòng ban khác..."
}
```

Lỗi validate còn kèm mảng `issues` chỉ rõ trường nào sai.

| Mã lỗi | Ý nghĩa |
| --- | --- |
| `UNAUTHENTICATED` | Chưa đăng nhập hoặc phiên hết hạn |
| `FORBIDDEN` | Sai vai trò hoặc ngoài phạm vi phòng ban |
| `CROSS_DEPT_ASSIGNMENT_FORBIDDEN` | Cố giao việc vượt cấp sang phòng ban khác |
| `SLA_LOCKED` | Quá hạn 2-4-5, bước này đã khoá |
| `KPI_FINALIZED` | Dòng KPI đã chốt, chỉ Ban Giám đốc mới sửa được |
| `REASON_REQUIRED` | Thao tác này bắt buộc ghi lý do |
| `VALIDATION_FAILED` | Dữ liệu gửi lên sai định dạng |
| `NOT_FOUND` | Không tìm thấy đối tượng |
| `INVALID_WEBHOOK_SECRET` | Sai chữ ký hoặc sai khoá bí mật webhook |

---

## Xác thực

### `POST /api/auth/login`
```json
{ "email": "ceo@ganifoody.vn", "password": "..." }
```
Trả về thông tin người dùng và đặt cookie phiên (hết hạn sau 12 giờ).

### `POST /api/auth/logout`
Xoá cookie phiên, ghi nhật ký.

---

## Công việc

### `GET /api/tasks`
Tham số lọc: `status`, `priority`, `assigneeId`, `departmentId`, `q`, `filter=overdue`.

Kết quả tự động giới hạn theo vai trò: nhân viên chỉ thấy việc của mình, trưởng phòng thấy cả phòng, Ban Giám đốc thấy toàn công ty.

### `POST /api/tasks`
Quyền: `MANAGER`, `CEO`.

```json
{
  "title": "Kiểm kê kho nguyên liệu ức gà",
  "description": "Đối soát tồn thực tế với iPOS",
  "departmentId": "...",
  "assigneeId": "...",
  "dueDate": "2026-09-10T17:00:00.000Z",
  "priority": "HIGH"
}
```

Trưởng phòng gửi `departmentId` hoặc `assigneeId` thuộc phòng khác sẽ nhận `403 CROSS_DEPT_ASSIGNMENT_FORBIDDEN`.
Tạo việc mức `CRITICAL` sẽ bắn cảnh báo Telegram tới Ban Giám đốc.

### `GET /api/tasks/:id` · `PATCH /api/tasks/:id`
`PATCH` nhận bất kỳ trường nào trong: `title`, `description`, `status`, `priority`, `progress`, `dueDate`, `assigneeId`, `note`.

Ràng buộc:
- Nhân viên không chuyển được sang `DONE` (đó là quyền nghiệm thu của trưởng phòng).
- Nhân viên không đổi được người phụ trách.
- Trưởng phòng không chuyển việc sang người của phòng khác.
- Chuyển sang `BLOCKED` sẽ ghi mốc `blockedSince` và báo trưởng phòng.
- Mỗi lần cập nhật đều chấm lại điểm rủi ro; vượt 80 điểm lần đầu thì bắn cảnh báo Ban Giám đốc.

### `POST /api/tasks/:id/comments`
```json
{ "body": "Đã nhận đủ nguyên liệu", "kind": "COMMENT" }
```
`kind` nhận `COMMENT` hoặc `EVIDENCE`.

---

## Yêu cầu liên phòng ban

### `GET /api/requests` · `POST /api/requests`
Quyền tạo: `MANAGER`, `CEO`.

```json
{
  "title": "Nhờ Sản xuất chạy thử mẻ 50kg",
  "targetDeptId": "...",
  "dueDate": "2026-09-12T17:00:00.000Z",
  "priority": "HIGH"
}
```

### `PATCH /api/requests/:id`
Chỉ trưởng phòng của phòng ban nhận (hoặc `CEO`) mới gọi được.

```json
{ "action": "ACCEPT", "assigneeId": "..." }
```
```json
{ "action": "REJECT", "rejectReason": "Xưởng kín lịch tới 20/09" }
```

`ACCEPT` sẽ tạo một công việc thật trong phòng ban nhận. `assigneeId` bắt buộc thuộc phòng ban đó.

---

## KPI

### `GET /api/kpi/periods` · `POST /api/kpi/periods`
Quyền tạo: `CEO`, `ADMIN`.

```json
{ "month": 9, "year": 2026, "autoAssign": true }
```
Hạn 2-4-5 được tính tự động vào tháng kế tiếp. `autoAssign` gán sẵn bộ chỉ tiêu của từng phòng ban cho mọi nhân sự.

### `POST /api/kpi/results/targets`
Đặt chỉ tiêu (`targetValue`) hàng loạt cho các dòng KPI của một kỳ. Quyền: `MANAGER` (nhân sự phòng mình, không tự đặt cho mình, chỉ khi kỳ còn `OPEN`), `CEO`, `ADMIN`. Không sửa được dòng đã chốt; sửa xong điểm được tính lại ngay.

```json
{ "periodId": "...", "updates": [{ "resultId": "...", "targetValue": 400000000 }] }
```

> Các route `/api/kpi/targets*` và `/api/kpi/calculate*` của bộ "6 KPI ca sản xuất" đã gỡ (10/2026). Điểm ca sản xuất chấm tự động khi khoá ca — xem `docs/KPI-SAN-XUAT.md`.

### `POST /api/kpi/results/:id`
Một endpoint, ba hành động phân biệt bằng trường `action`.

**Nhân viên tự khai** — chỉ chính chủ, chỉ trước 23:59 ngày 2:
```json
{ "action": "SELF_REVIEW", "actualSelf": 520000000, "selfNote": "..." }
```

**Trưởng phòng duyệt** — trước 23:59 ngày 4; sửa khác số nhân viên khai thì `reason` là bắt buộc:
```json
{ "action": "MANAGER_REVIEW", "actualFinal": 520000000, "reason": "..." }
```

**Ban Giám đốc sửa điểm đã khoá** — `reason` tối thiểu 10 ký tự:
```json
{ "action": "EDIT_LOCKED", "actualFinal": 480000000, "reason": "Đối soát lại hoá đơn thực tế" }
```

Kết quả trả về đã tính sẵn `achievementPercent` (đã cắt trần 150), `weightedScore`, `isCapped`, `hasMismatch`, `mismatchPercent`.

### `POST /api/kpi/approve`
Quyền: `CEO`. Duyệt và khoá vĩnh viễn.

```json
{ "periodId": "...", "finalizePeriod": true }
```
Hoặc chỉ định cụ thể: `{ "resultIds": ["...", "..."] }`, hoặc gói theo người: `{ "periodId": "...", "employeeId": "..." }`.

`finalizePeriod: true` sẽ khoá luôn cả kỳ nếu không còn dòng nào chưa chốt.

### `GET /api/kpi/template`
Tải file Excel mẫu để nạp số. Quyền: `MANAGER`, `CEO`, `ADMIN`.

### `POST /api/kpi/import`
`multipart/form-data` với `file` (.xlsx) và `periodId`. Số vào cột *Số hệ thống*, không đè lên số nhân viên tự khai. Trả về số dòng vào được, số dòng lỗi kèm lý do từng dòng, và số dòng phát sinh lệch số liệu.

### `GET /api/kpi/export?periodId=...`
Xuất Excel 2 sheet, chỉ gồm phần dữ liệu người gọi có quyền xem.

---

## AI (Phase 2)

Nguyên tắc chung của cả nhóm endpoint này: **không có cái nào ghi thẳng vào
`tasks` hay `kpi_results`**. Mọi kết quả đều rơi vào bảng `ai_suggestions` ở
trạng thái `PENDING`, phải có người duyệt mới thành dữ liệu thật.

Khi chưa cấu hình `GEMINI_API_KEY`, hệ thống tự chuyển sang bộ đọc luật cứng.
Trường `engine` trong kết quả luôn cho biết bên nào đã xử lý: `GEMINI` hoặc
`RULE_BASED`.

### `POST /api/ai/parse-task`
Quyền: `MANAGER`, `CEO`.

```json
{ "text": "Nhờ Lê Thị Hồng gọi lại 20 khách sỉ chưa chốt đơn, gấp, xong trước 5h chiều mai" }
```

Trả về:
```json
{
  "suggestionId": "...",
  "draft": {
    "title": "...", "description": null,
    "assigneeId": "...", "assigneeName": "Lê Thị Hồng",
    "dueDate": "2026-09-08T10:00:00.000Z", "priority": "HIGH"
  },
  "confidencePercent": 80,
  "rationale": "Bộ đọc luật cứng: nhận ra tên ... ; hiểu \"mai\" là ...",
  "missingInfo": [],
  "engine": "RULE_BASED",
  "sanitizeFlagged": false,
  "isDraft": true
}
```

Danh sách nhân sự đưa cho máy đã được lọc theo quyền của người gọi — trưởng phòng
thì máy chỉ nhìn thấy người trong phòng đó, nên không thể gợi ý người phòng khác.
Thiếu người phụ trách hoặc hạn chót thì mục đó vào `missingInfo` và
`confidencePercent` bị ép xuống dưới 60.

### `POST /api/ai/suggestions/:id`
Quyết định số phận của một đề xuất.

```json
{
  "action": "ACCEPT",
  "title": "...", "departmentId": "...", "assigneeId": "...",
  "dueDate": "2026-09-10T10:00:00.000Z", "priority": "HIGH"
}
```
```json
{ "action": "REJECT", "reason": "Không đúng ý" }
```

`ACCEPT` đi qua đúng hàm tạo việc bình thường, nên vẫn nhận `403
CROSS_DEPT_ASSIGNMENT_FORBIDDEN` nếu giao vượt cấp. Việc tạo ra được đánh dấu
`isAiGenerated = true` kèm `aiConfidence`. Phần người dùng sửa khác máy được ghi
vào nhật ký để sau này biết máy đọc sai chỗ nào. Một đề xuất chỉ duyệt được một
lần — gọi lại nhận `409`.

### `POST /api/ai/kpi-advisory`
Quyền: `MANAGER` (trong phòng mình), `CEO`.

```json
{ "kpiResultId": "..." }
```

Trả về `suggestedScore` (không bao giờ vượt 150), `confidencePercent`,
`factSummary` (số liệu thật), `aiInference` (phần suy đoán), `strengths`,
`weaknesses`, `risks`, `recommendation`, kèm `disclaimer`.

Nếu điểm máy đề xuất lệch quá 20 điểm phần trăm so với công thức của hệ thống,
hệ thống kéo về số của mình và ghi cảnh báo vào `risks` — công thức là chuẩn, máy
không được phép đè lên.

## Phân tích & Dự báo (Phase 4)

Nguyên tắc chung của cả nhóm này: **mọi con số trả về đều kèm `sampleSize` và
`confidence`** (`NONE` / `LOW` / `MEDIUM` / `HIGH`). Dưới ngưỡng dữ liệu tối
thiểu, hệ thống trả về `confidence: "NONE"` và **không đưa ra kết luận** — bên
tích hợp phải tôn trọng cờ này, đừng hiển thị con số như thể nó chắc chắn.

### `GET /api/analytics?departmentId=...`
Quyền: `MANAGER` (bị khoá cứng vào phòng của mình — tham số `departmentId` bị bỏ
qua), `CEO` (toàn công ty, hoặc lọc theo phòng).

Trả về bốn khối:

| Khối | Nội dung |
| --- | --- |
| `predictions` | Từng việc đang mở: `completionProbability`, `projectedDelayDays`, `riskCategory` (`ON_TRACK` / `AT_RISK` / `HIGH_FAILURE_RISK`), `factors` (giải thích bằng số), `confidence` |
| `capacity` | Từng người: `utilizationPercent`, `openHours`, `overdueHours`, `band` (`OVERLOADED` / `NORMAL` / `UNDERUTILIZED`), kèm `rebalanceSuggestions` |
| `accuracy` | Hệ thống tự chấm lại dự báo cũ: `truePositive`, `falsePositive`, `falseNegative`, `trueNegative`, `accuracyPercent`. Chưa có việc nào đóng sau khi dự báo thì trả `null` chứ không bịa số |
| `health` | Chỉ `CEO`: điểm sức khoẻ 0–100 và 5 thành phần cấu thành. `MANAGER` nhận `null` |

Gợi ý san việc **chỉ trong cùng phòng ban** và **chỉ đề nghị chuyển vừa đủ** để
kéo người quá tải về 100%, giới hạn bởi phần dư của người nhận.

### `POST /api/analytics/anomalies/:id`
Xử lý một cảnh báo khai báo KPI bất thường. Hai hành động:

```json
{ "action": "EXPLAIN", "explanationText": "tối thiểu 20 ký tự" }
```
Quyền: **chính người bị nêu tên**. Không ai giải trình hộ số liệu của người khác.

```json
{ "action": "REVIEW", "accepted": true, "reviewNote": "tối thiểu 10 ký tự" }
```
Quyền: trưởng phòng của người đó, hoặc `CEO`.

Cảnh báo **không tự trừ điểm và không khoá gì cả** — nó chỉ là dấu hiệu thống kê.
Mọi bước xử lý đều vào nhật ký. Lượt quét sau không ghi đè cảnh báo đã xử lý.

### `POST /api/ai/executive-briefing`
Quyền: `CEO` duy nhất. Trưởng phòng cũng bị chặn.

Trả về `healthScore`, `healthLabel`, `summary`, `keyRisks`, `recommendations`,
`dataBasis`, `disclaimer`. **`healthScore` luôn là số của hệ thống**, tính bằng
công thức cố định trong `lib/analytics/constants.ts`; AI chỉ viết phần chữ. Nếu
AI trả về một điểm khác, điểm đó bị bỏ. Không có khoá AI thì hệ thống tự viết
báo cáo bằng luật cứng. Kết quả lưu vào bảng `ai_suggestions` để tra lại.

---

## Gantt & phụ thuộc công việc

### `POST /api/tasks/:id/dependencies`
Quyền: trưởng phòng phụ trách việc đó, hoặc `CEO`.

```json
{ "dependsOnId": "id-cua-viec-phai-cho-xong-truoc" }
```

Bị chặn khi: nối vào chính nó, tạo thành vòng lặp, hoặc trưởng phòng nối sang
việc của phòng ban khác.

### `DELETE /api/tasks/:id/dependencies?dependsOnId=...`
Gỡ một quan hệ phụ thuộc.

Dữ liệu Gantt và đường găng được tính ngay trong trang `/tasks/gantt` (server
component) chứ không qua endpoint riêng — nên không có vòng gọi mạng thừa.

## Tích hợp hệ thống bên ngoài (Phase 3)

### `POST /api/integrations/:source/webhook`
Một địa chỉ cho mọi hệ thống bên ngoài. `:source` là mã nguồn khai ở
**Quản trị → Tích hợp**.

Không cần đăng nhập. Xác thực bằng chữ ký HMAC SHA256:

```
X-Timestamp: <giây UNIX>
X-Signature: sha256=<HMAC_SHA256("<timestamp>.<body nguyên văn>", secret)>
```

Thân tin — một bản ghi hoặc mảng tối đa 500:
```json
[
  { "kpiCode": "SALES_REV", "employeeEmail": "nv.sales1@ganifoody.vn",
    "month": 9, "year": 2026, "value": 520000000 }
]
```

Trả về:
```json
{
  "status": "OK",
  "received": 1, "applied": 1, "rejected": 0,
  "mismatches": 0,
  "errors": []
}
```

| Mã | Khi nào |
| --- | --- |
| 200 | Nhận thành công (kể cả khi có dòng bị bỏ qua — xem `errors`) |
| 401 | Thiếu chữ ký, sai chữ ký, thiếu dấu thời gian, hoặc gói tin cũ quá 5 phút |
| 403 | Nguồn đang bị tạm ngưng |
| 404 | Mã nguồn chưa được đăng ký |
| 422 | Thân tin sai định dạng |

**Chống phát lại:** dấu thời gian lệch quá 5 phút so với máy chủ thì bị từ chối.
Kẻ chặn được đường truyền không thể lưu một gói hợp lệ rồi bắn lại sau để ghi đè
số liệu.

**An toàn khoá dữ liệu:** kỳ hoặc dòng KPI đã `FINALIZED` thì webhook không ghi
đè được — nhưng dữ liệu thô vẫn được lưu vào `kpi_actual_feeds` để tra cứu sau.

Nguồn `ipos` còn nhận được cách xác thực cũ bằng header `X-Webhook-Secret`
(khớp `IPOS_WEBHOOK_SECRET` trong .env) để đường tích hợp làm từ Phase 1 không gãy.
Cách này yếu hơn vì không có chống phát lại — nên chuyển sang HMAC khi có thể.

### `POST /api/admin/integrations`
Quyền: `ADMIN`, `CEO`. Tạo nguồn mới và sinh khoá bí mật.

```json
{ "code": "ipos", "name": "Phần mềm bán hàng iPOS", "kind": "IPOS", "priority": 5 }
```

`kind`: `IPOS` | `CRM` | `ERP` | `SHEETS` | `OTHER`.
`priority`: số nhỏ = tin hơn, **chỉ dùng khi các nguồn đã khớp nhau**, không dùng
để tự chọn số khi đang lệch.

Khoá bí mật chỉ trả về **đúng lần này**, không lưu lại chỗ nào để hiện lại.

### `PATCH /api/admin/integrations?id=...`
```json
{ "name": "...", "priority": 5, "isActive": false, "rotateSecret": true }
```
`rotateSecret` sinh khoá mới và **huỷ khoá cũ ngay lập tức**.

---

## Đối soát dữ liệu (Phase 3)

Đối soát chạy tự động mỗi lần có dữ liệu mới vào, và trong mỗi lượt cron. Không
có endpoint để kích hoạt riêng — nó là một bước trong `/api/cron/run`.

Quy tắc: các nguồn lệch nhau **≤ 5%** thì tự đồng bộ vào `actualSystem` theo nguồn
tin cậy nhất. Lệch **> 5%** thì **không ghi số nào**, treo lại ở trạng thái
`MISMATCH` và bắn cảnh báo cho Ban Giám đốc.

### `POST /api/reconciliation/:id`
Quyền: `MANAGER` (trong phòng mình), `CEO`.

```json
{
  "value": 500000000,
  "sourceCode": "ipos",
  "reason": "Đã đối chiếu hoá đơn giấy với kế toán, số iPOS mới là số đúng"
}
```

`reason` bắt buộc, tối thiểu 10 ký tự. `sourceCode` ghi lại đã chọn theo nguồn
nào; nhập số ngoài mọi nguồn thì dùng `MANUAL_OVERRIDE`.

Sinh một bản ghi `RECONCILIATION_RESOLVE` trong nhật ký kèm số của **tất cả** các
nguồn tại thời điểm đó, và báo cho nhân viên biết số của họ đã bị chốt theo nguồn
nào.

---

## Telegram (Phase 3)

### `POST /api/telegram/webhook`
Nơi Telegram gọi vào khi có người nhắn bot hoặc bấm nút.

Bắt buộc có header `X-Telegram-Bot-Api-Secret-Token` khớp `TELEGRAM_WEBHOOK_SECRET`.
Thiếu hoặc sai → 401, chưa đọc tới nội dung.

Ba lớp kiểm soát trước khi một thao tác được thực hiện:
1. Khoá bí mật của webhook (chặn gói tin tự chế).
2. `from.id` phải khớp một tài khoản đang hoạt động (`telegramChatId`).
3. Thao tác đi qua đúng hàm nghiệp vụ như trên web — vẫn bị chặn quyền, vẫn ghi
   nhật ký với `userAgent = "telegram-bot"`.

**Nút bấm hỗ trợ:**

| callback_data | Ai bấm được | Việc |
| --- | --- | --- |
| `KPI_APPROVE:<id>` | chỉ `CEO` | Duyệt và khoá dòng KPI |
| `KPI_EXPLAIN:<id>` | `CEO`, `MANAGER` cùng phòng | Yêu cầu nhân viên giải trình |
| `TASK_REVIEW:<id>` | chính người được giao việc | Báo xong, chờ nghiệm thu |

Endpoint luôn trả 200 cho gói tin hợp lệ, kể cả khi thao tác bị từ chối — trả mã
lỗi thì Telegram sẽ gửi lại gói tin đó liên tục. Kết quả nằm trong thân trả về
(`denied`, `approved`) và được báo cho người bấm ngay trong Telegram.

### `POST /api/telegram/link`
Sinh mã 6 số để người dùng tự nối tài khoản Telegram của chính mình. Mã sống 10
phút, dùng một lần. Mỗi người chỉ có một mã còn hiệu lực tại một thời điểm.

### `DELETE /api/telegram/link`
Ngắt nối (tương đương lệnh `/huy` trong Telegram).

---

## Tài khoản & mật khẩu

### `POST /api/auth/change-password`
Quyền: mọi vai trò đã đăng nhập.

```json
{ "currentPassword": "...", "newPassword": "..." }
```

**Chỉ đổi được mật khẩu của chính người đang đăng nhập.** Endpoint không nhận
tham số `userId` — gửi kèm cũng bị bỏ qua, không phải bị từ chối. Quản trị muốn
đặt lại cho người khác thì đi `PATCH /api/admin/users/:id`.

Bắt buộc có `currentPassword`: phiên đăng nhập đang mở không đủ để chiếm tài khoản.

Luật mật khẩu (`lib/password.ts`): tối thiểu 10 ký tự, có cả chữ và số, không
khoảng trắng, không chứa tên hoặc email của chính mình, không phải mật khẩu mẫu,
không trùng mật khẩu đang dùng. Sai bất kỳ điều nào → **400** kèm lý do cụ thể.

Đổi xong thì cờ `mustChangePassword` được gỡ. Cả lần thành công lẫn **lần thất bại
vì sai mật khẩu hiện tại** đều vào nhật ký; nhật ký không chứa mật khẩu.

### `POST /api/auth/login` — trường bổ sung
Trả thêm `mustChangePassword`. Bằng `true` nghĩa là mật khẩu hiện tại do quản trị
đặt hộ; bên gọi phải đưa người dùng qua `/doi-mat-khau` trước khi làm gì khác.
Giao diện web tự chặn ở tầng layout.

### `GET /api/admin/users/template`
Quyền: `ADMIN`. Tải file Excel mẫu để nạp nhân sự (kèm sheet hướng dẫn và danh
mục mã phòng ban).

### `POST /api/admin/users/import`
Quyền: `ADMIN` duy nhất — Ban Giám đốc cũng bị chặn. Gửi `multipart/form-data`
với trường `file`.

**Được ăn cả, ngã về không:** sai một dòng là từ chối cả file, không tạo tài khoản
nào. Trả **422** kèm `errors` liệt kê đủ từng dòng sai và lý do.

Cột: `HO_TEN`, `EMAIL`, `MAT_KHAU_TAM`, `VAI_TRO`, `MA_PHONG_BAN`, `CHUC_DANH`,
`DIEN_THOAI`, `VAI_TRO_XUONG`.

Những gì bị chặn:

| Trường hợp | Vì sao |
| --- | --- |
| `VAI_TRO` là `CEO` hoặc `ADMIN` | Tạo quyền cao nhất bằng một dòng Excel là đường leo thang quyền quá dễ — phải tạo tay |
| Email trùng nhau trong cùng file | Không đoán hộ ý người điền |
| Email đã có tài khoản | Không ghi đè người đang dùng hệ thống |
| `MAT_KHAU_TAM` không đạt luật mật khẩu | Đường Excel không được lỏng hơn hai đường kia |
| `MA_PHONG_BAN` không có thật | Kèm danh sách mã hợp lệ trong thông báo lỗi |
| `VAI_TRO_XUONG` sai chính tả | Kèm danh sách giá trị hợp lệ |

Thành công → **200** kèm `created` và `createdUsers`. Mọi tài khoản tạo ra đều bật
`mustChangePassword`, vì mật khẩu tạm nằm trong file mà nhiều người xem được.

---

## Quản trị

| Endpoint | Quyền | Việc |
| --- | --- | --- |
| `POST /api/admin/users` | `ADMIN` | Tạo tài khoản |
| `PATCH /api/admin/users/:id` | `ADMIN` | Sửa vai trò, phòng ban, Chat ID, khoá/mở, đặt lại mật khẩu |
| `POST /api/admin/departments` | `ADMIN` | Thêm phòng ban |
| `POST /api/admin/kpi-definitions` | `CEO`, `ADMIN` | Thêm chỉ tiêu |
| `PATCH /api/admin/kpi-definitions?id=` | `CEO`, `ADMIN` | Sửa hoặc ngưng dùng chỉ tiêu |
| `POST /api/admin/telegram-test` | `CEO`, `ADMIN` | Bắn tin thử Telegram |
| `POST /api/notifications/read` | mọi vai trò | Đánh dấu đã đọc toàn bộ thông báo |

Hệ thống chặn hai trường hợp nguy hiểm: tự khoá tài khoản của chính mình, và hạ quyền/khoá tài khoản Ban Giám đốc cuối cùng còn hoạt động.
