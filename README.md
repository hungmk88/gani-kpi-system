# GANI FOODY — Hệ thống Quản lý Công việc & KPI

Bản triển khai **Phase 1 (MVP Core)**, **Phase 2 (AI Engine & Advanced Views)**, **Phase 3 (Integration & Automation)**, **Phase 4 (Phân tích & Dự báo)** và **KPI Bộ phận Sản xuất 2 tầng** theo đúng tài liệu thiết kế đã được Ban Giám đốc phê duyệt.

---

## 1. Chạy hệ thống trong 3 lệnh

> **Muốn dùng ngay, không cần chạy gì cả:** hệ thống đã sống tại
> **[gani-kpi-system.vercel.app](https://gani-kpi-system.vercel.app)**. Mục
> này chỉ cần khi anh muốn sửa code hoặc chạy thử trên máy.

> **Lưu ý quan trọng:** `prisma/schema.prisma` giờ cố định `provider =
> "postgresql"` — **không còn chạy SQLite cục bộ mặc định nữa.** `DATABASE_URL`
> trong `.env` phải trỏ vào một database Postgres thật (Supabase) trước khi làm
> gì khác. Xem mục 8c để tạo project Postgres **riêng cho máy dev**, tách khỏi
> project production — đừng trỏ máy local vào thẳng database đang phục vụ
> `gani-kpi-system.vercel.app`.

Mở terminal tại thư mục dự án:

```bash
npm install
```

```bash
npm run setup
```

```bash
npm run dev
```

Mở trình duyệt vào **http://localhost:3000**.

| Vai trò | Email |
| --- | --- |
| Ban Giám đốc | `ceo@ganifoody.vn` |
| Trưởng phòng Kinh doanh | `tp.sales@ganifoody.vn` |
| Nhân viên Kinh doanh | `nv.sales1@ganifoody.vn` |
| Quản trị hệ thống | `admin@ganifoody.vn` |

Có sẵn 19 tài khoản của 8 phòng ban. **Mật khẩu tạm** lấy từ biến
`SEED_PASSWORD` trong `.env`; không đặt thì `npm run setup` tự sinh ngẫu nhiên và
in ra màn hình **một lần**. Mọi tài khoản mới tạo đều bị chặn ở trang đổi mật
khẩu ngay lần đăng nhập đầu tiên, phải tự đặt mật khẩu riêng.

Seed từ chối chạy khi `NODE_ENV=production` (trừ khi đặt `ALLOW_PROD_SEED=1`), và
`npm run db:reset` chỉ chạy được với database trên máy local.

Muốn chạy bản production (nhanh hơn, nhẹ máy hơn):

```bash
npm run build
```

```bash
npm start
```

---

## 0. Bản sửa sau review 10/2026 — việc PHẢI làm khi deploy

Bản này vá các lỗ bảo mật và lỗi nghiệp vụ tìm thấy khi review toàn bộ dự án.
Làm đúng thứ tự:

1. **Đổi `JWT_SECRET` trên Vercel** (`openssl rand -hex 48`). Secret cũ từng nằm
   trong `scripts/create-test-token.mjs` trong lịch sử git — coi như đã lộ. Hệ
   thống giờ từ chối chạy nếu secret ngắn hơn 32 ký tự hoặc còn chuỗi mẫu.
   Đổi xong mọi người phải đăng nhập lại.
2. **Đổi `CRON_SECRET`, `IPOS_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_SECRET`** nếu
   còn là chuỗi mẫu trong `.env.example` — chuỗi mẫu giờ bị từ chối.
3. **cron-job.org:** bắt buộc `POST` và secret trong header `x-cron-secret`.
   `GET` và `?secret=` trên URL không còn được nhận.
4. **Chạy migration** (máy có `DIRECT_URL` của production):
   `npx prisma migrate deploy` — thêm bảng `job_locks` và các index.
   Migration `20261016090000_money_int_and_checks` đổi các cột tiền sang số
   nguyên VND (làm tròn đến đồng) và thêm CHECK constraint cho vai trò / trạng
   thái / ca. Sau đó chạy `npm run db:validate-checks` — nó liệt kê dòng CŨ nào
   mang giá trị lạ (vd ca "MORNING"); sửa các dòng đó rồi chạy
   `npm run db:validate-checks -- --apply` để xác nhận constraint.
5. **Sửa dữ liệu ngày giờ cũ** — sao lưu trước, chạy thử, xem kỹ rồi mới sửa thật:
   `npm run fix:dates` rồi `npm run fix:dates -- --apply`.
   Sửa hạn chốt 2-4-5 của các kỳ chưa chốt (trước lệch 7–14 tiếng) và ngày ca
   sản xuất bị lùi một ngày do server chạy giờ UTC.
6. **Đổi mật khẩu `ceo@` và `admin@`** nếu vẫn là `Gani@2026`. Kiểm tra và khoá
   tài khoản `test-ceo@example.com` nếu có.
7. **Sao lưu tự động:** thêm secret `BACKUP_DATABASE_URL` (DIRECT_URL) và
   `BACKUP_PASSPHRASE` vào GitHub → Settings → Secrets → Actions. Workflow
   `.github/workflows/backup.yml` chạy mỗi đêm, bản sao được mã hoá.

Thay đổi hành vi người dùng sẽ thấy:

- Ban Giám đốc chỉ chốt được dòng KPI đã qua bước trưởng phòng (duyệt tay hoặc tự
  khoá ngày 4). Dòng không có số liệu được 0 điểm, không còn tự lấy số 0.
- Trưởng phòng không tự duyệt / tự đặt mục tiêu / tự chốt đối soát cho chính mình.
  Nhập số khác với các nguồn khi đối soát là quyền riêng của Ban Giám đốc.
- Nghỉ phép: đơn 1 ngày tính 1 ngày (trước tính 0). Trần 12 ngày/năm và 6
  ngày/nửa năm được kiểm tra thật khi gửi và khi duyệt.
- Đăng nhập sai 5 lần trong 15 phút thì tạm khoá 15 phút.
- Bot Telegram chỉ làm việc trong chat riêng.
- Tính điểm 6 KPI ca: server tự lấy số từ ca đã khoá, chỉ tiêu kỳ phải được Ban
  Giám đốc duyệt trước.

---

## 2. Bốn quyết định của Ban Giám đốc, và chúng nằm ở đâu trong mã nguồn

Toàn bộ nằm trong một file duy nhất: **`lib/constants.ts`**. Sửa một chỗ, cả hệ thống đổi theo.

| Quyết định | Cách hệ thống thực thi | File |
| --- | --- | --- |
| Thang điểm 100, cho vượt chỉ tiêu, **trần 150%** | `KPI_SCORE_CAP = 150`. Mức đạt bị cắt còn 150 rồi mới nhân trọng số; dòng bị cắt được đánh dấu `isCapped` để trưởng phòng nhìn thấy | `lib/kpi.ts` |
| Cảnh báo qua **Telegram** | Mọi cảnh báo đỏ bắn về Telegram Ban Giám đốc; mỗi người có `telegramChatId` riêng cũng nhận thông báo của mình | `lib/telegram.ts` |
| Chốt KPI theo lịch **2 – 4 – 5** | 23:59 ngày 2 khoá nhân viên, 23:59 ngày 4 khoá trưởng phòng, ngày 5 Ban Giám đốc chốt. Chạy tự động, không cần ai bấm | `lib/services/kpi-service.ts` |
| **Cấm giao việc vượt cấp** | Trưởng phòng chỉ giao được trong phòng mình. Cần nhờ phòng khác thì đi qua **Yêu cầu liên phòng ban** | `lib/rbac.ts` |

Ngoài ra, ngưỡng lệch số liệu là **±5%** (`DATA_MISMATCH_THRESHOLD_PERCENT`), và việc bị chặn quá **24 giờ** thì đẩy vào bảng ngoại lệ của Ban Giám đốc.

---

## 3. Luồng làm việc hàng tháng

### Đầu kỳ
Ban Giám đốc hoặc quản trị vào **KPI → Mở kỳ KPI mới**. Hệ thống tự gán bộ chỉ tiêu của từng phòng ban cho toàn bộ nhân sự, lấy chỉ tiêu giao theo kỳ gần nhất.

### Trong kỳ
- Nhân viên vào **Công việc**, bấm 3 nút là xong: *Bắt đầu làm* → *Xong, xin nghiệm thu*. Việc tắc thì bấm *Báo tắc*, trưởng phòng nhận thông báo ngay.
- Kế toán/quản lý nạp số thực tế: **KPI → Tải file mẫu nhập số**, điền, rồi **Nạp số từ Excel**. Số này vào cột *Số hệ thống*, không đè lên số nhân viên tự khai.
- iPOS/ERP đẩy số tự động qua webhook (mục 6 bên dưới) cũng vào đúng cột đó.

### Chốt kỳ
1. **Đến hết ngày 2** — nhân viên tự khai số thực tế + giải trình. Quá 23:59 ngày 2 hệ thống khoá, ai chưa khai thì dòng đó tự đẩy sang bước sau.
2. **Đến hết ngày 4** — trưởng phòng duyệt hoặc điều chỉnh. Sửa khác số nhân viên khai thì **bắt buộc ghi lý do**, và nhân viên nhận thông báo về việc bị sửa.
3. **Ngày 5** — Ban Giám đốc mở bảng, bấm *Duyệt tất cả & chốt kỳ*. Điểm khoá vĩnh viễn.

Sau khi khoá, chỉ Ban Giám đốc sửa được, phải ghi lý do tối thiểu 10 ký tự, và mỗi lần sửa đẻ ra một bản ghi không xoá được trong **Nhật ký hệ thống**.

---

## 4. Bật bộ máy chạy nền

Không có bước này thì lịch khoá 2-4-5, việc đối soát dữ liệu, quét rủi ro và nhắc
hạn sẽ không tự chạy.

Mở **cửa sổ PowerShell thứ hai**, để nguyên đó:

```bash
npm run scheduler
```

Mỗi lượt chạy làm đủ 7 việc, theo đúng thứ tự này vì việc sau cần kết quả việc trước:

1. Khoá KPI theo lịch 2-4-5
2. Gộp ca sản xuất đã khoá thành số liệu KPI tháng
3. Đối soát dữ liệu đa nguồn — khớp thì đồng bộ, lệch thì treo lại chờ người quyết
4. Tính lại điểm các dòng chưa chốt
5. Quét rủi ro toàn bộ công việc đang mở
6. Phân tích & dự báo: chấm lại các dự báo cũ nay đã biết kết quả, dự báo lại
   việc đang mở, quét bất thường khai báo KPI
7. Nhắc hạn cho ai còn việc chưa làm

Lịch: khoá KPI 00:05 ngày 3 và ngày 5 (ngay sau hạn 23:59:59 ngày 2 và 4), nhắc
hạn 08:10 hàng ngày, đối soát và quét rủi ro mỗi 2 tiếng. Hai lượt chạy trùng
nhau thì lượt sau nhận 409 (có khoá chống chạy chồng), không làm hỏng dữ liệu.

Nếu không muốn mở cửa sổ thứ hai, Ban Giám đốc có thể bấm **Quét lại rủi ro ngay**
trên Bảng điều hành bất cứ lúc nào — hai đường cùng chạy một logic. Lời nhắc có
chặn trùng nên bấm nhiều lần cũng không spam ai.

> **Trên production (Vercel):** `npm run scheduler` chỉ chạy được khi có một tiến
> trình sống liên tục — không hợp với serverless. Bản deploy thật dùng
> **cron-job.org** gọi `POST /api/cron/run` mỗi 2 tiếng, chạy đúng 7 việc y hệt
> danh sách trên. Xem mục 8.

---

## 5. Bật cảnh báo Telegram

1. Mở Telegram, tìm **@BotFather**, gõ `/newbot`, đặt tên. BotFather trả về một chuỗi token.
2. Nhắn một tin bất kỳ cho bot vừa tạo, rồi mở link này trên trình duyệt để lấy Chat ID:
   `https://api.telegram.org/bot<TOKEN>/getUpdates` — số trong `"chat":{"id": ...}` chính là Chat ID.
3. Mở file `.env`, điền:

   ```
   TELEGRAM_BOT_TOKEN="token BotFather vừa cho"
   CEO_TELEGRAM_CHAT_ID="chat id của Ban Giám đốc hoặc nhóm BGĐ"
   TELEGRAM_ENABLED="true"
   ```

4. Khởi động lại server, vào **Quản trị → Kết nối & cấu hình → Gửi tin thử**.
5. Muốn từng nhân viên nhận thông báo riêng: **Quản trị → Tài khoản → Sửa**, điền Chat ID của họ.

Khi chưa bật, hệ thống vẫn chạy bình thường — mọi thông báo lưu trong mục **Thông báo** trong ứng dụng.

---

## 5b. Bật AI (Phase 2)

Hệ thống **chạy được mà không cần khoá AI**. Khi chưa có khoá, phần trợ lý dùng
bộ đọc luật cứng viết riêng cho tiếng Việt — kém linh hoạt hơn nhưng chạy tức
thì, không tốn tiền, không cần mạng, và cùng một câu vào thì luôn ra cùng một
kết quả.

Muốn dùng Gemini cho thông minh hơn:

1. Vào https://aistudio.google.com/apikey lấy khoá miễn phí.
2. Điền vào `.env`:

   ```
   GEMINI_API_KEY="khoá vừa lấy"
   GEMINI_MODEL="gemini-3.6-flash"
   ```

3. Khởi động lại server.

Giao diện luôn ghi rõ kết quả đang do bên nào sinh ra — *Gemini* hay *Bộ đọc luật
cứng* — nên không bao giờ có chuyện nhầm lẫn nguồn gốc.

### Ba tầng chắn của AI

| Tầng | Việc nó làm | Nằm ở đâu |
| --- | --- | --- |
| 1. Làm sạch đầu vào | Cắt câu lệnh chèn (prompt injection), bỏ ký tự vô hình, giới hạn 2000 ký tự | `lib/ai/provider.ts` |
| 2. Ép định dạng | Bắt Gemini trả về đúng JSON Schema, rồi Zod kiểm lại lần nữa | `lib/ai/*.ts` |
| 3. Người quyết định | Mọi kết quả nằm chờ ở bảng `ai_suggestions`, người bấm mới thành dữ liệu thật | `lib/services/ai-service.ts` |

**Không có đường nào để AI tự ghi vào bảng công việc hay bảng điểm KPI.** Việc do
máy đọc ra vẫn phải đi qua đúng chốt chặn cấm giao việc vượt cấp như khi làm tay,
và được đánh dấu 🪄 để phân biệt.

## 5c. Những gì Phase 2 thêm vào

**Trợ lý giao việc** — Trang *Công việc*, ô "Gõ một câu, máy dựng thành việc".
Gõ như đang nhắn tin: *"Nhờ Lê Thị Hồng gọi lại 20 khách sỉ chưa chốt đơn, gấp,
xong trước 5h chiều mai"*. Máy tách ra người phụ trách, hạn chót, mức ưu tiên,
kèm mức tự tin và danh sách thứ còn thiếu. Thiếu gì thì gắn cờ **CẦN XÁC NHẬN**
chứ không bịa.

**Cố vấn KPI** — Trong bảng duyệt KPI, mỗi dòng có nút *Xin phân tích tham khảo*.
Kết quả tách bạch hai phần: **SỐ LIỆU THẬT** lấy thẳng từ database, và **PHẦN MÁY
SUY ĐOÁN** có thể sai. Có điểm đề xuất (không bao giờ vượt 150), mức tự tin, điểm
được, điểm hụt, và một gợi ý hành động cụ thể. Máy không ghi gì vào bảng điểm.

**Chấm rủi ro sâu hơn** — Bổ sung hai yếu tố ngữ cảnh mà Phase 1 chưa nhìn ra:
người phụ trách đang ôm quá 5 việc dở dang (quá tải), và việc đang đứng chờ một
việc khác đã trễ hạn (mắt xích gãy).

**Biểu đồ Gantt** — `/tasks/gantt`. Tính đường găng bằng thuật toán CPM chuẩn
(một lượt đi tới, một lượt đi lui), hiện dư địa từng việc, vẽ đường nối phụ
thuộc. Nối thành vòng lặp thì hệ thống chặn ngay lúc thêm.

**Lịch công việc** — `/tasks/calendar`. Lưới tháng, việc xếp vào ngày hết hạn.

**Báo cáo điều hành PDF** — `/reports/kpi/<id>`, mở từ nút trong bảng KPI. Bấm In
rồi chọn "Save as PDF" là ra file. Không cài thư viện dựng PDF nào — hộp thoại in
của trình duyệt cho chữ tiếng Việt sắc nét hơn, và đỡ cho máy vài trăm MB.

## 5d. Những gì Phase 3 thêm vào

**Đối soát dữ liệu đa nguồn** — `/reconciliation`. Khi iPOS, file Excel và số
nhân viên tự khai đá nhau quá 5%, hệ thống **không tự chọn con số nào**. Nó treo ô
đó lại, hiện cả ba số cạnh nhau, bắt người có thẩm quyền chỉ đúng một nguồn và
ghi lý do. Đây là điểm quan trọng nhất của Phase 3: nếu để máy tự chọn "nguồn ưu
tiên", cuối tháng không ai biết con số trên phiếu KPI từ đâu ra, và cãi nhau
không có căn cứ.

**Cổng tích hợp có chữ ký thật** — một địa chỉ duy nhất cho iPOS, CRM, ERP, Google
Sheets. Mỗi nguồn một khoá riêng, ký HMAC SHA256 kèm chống phát lại gói cũ. Mọi
lần gọi vào đều vào nhật ký, kể cả lần bị chặn.

**Bot Telegram tương tác** — Ban Giám đốc duyệt KPI ngay trong tin nhắn bằng nút
bấm. Nhân viên gõ `/homnay` xem việc, `/kpi` xem điểm. Ai cũng tự nối tài khoản
bằng mã 6 số, không cần quản trị đi hỏi chat id từng người.

**Cổng Zalo ZNS** — gửi nhắc hạn qua Zalo theo mẫu đã đăng ký. Tắt mặc định.

**Nhắc hạn tự động** — trước hạn 1 ngày và đúng ngày hết hạn, ai còn việc chưa
làm thì nhận nhắc. Mỗi người chỉ nhận một lần mỗi ngày dù bộ máy chạy 12 lượt.

---

## 5e. KPI Bộ phận Sản xuất (2 tầng)

Xưởng có cách chấm riêng, không dùng chung luồng KPI tháng của khối văn phòng. Chi tiết công thức đầy đủ nằm ở **[docs/KPI-SAN-XUAT.md](docs/KPI-SAN-XUAT.md)**.

### Luồng 3 bước bắt buộc

```
BƯỚC 1 — SẢN XUẤT      BƯỚC 2 — KCS            BƯỚC 3 — BAN GIÁM ĐỐC
Sản lượng thô          Đạt / làm lại / phế     Chỉ tiêu + khoá số
Giờ công từng người    Vi phạm HACCP                    │
NVL kho cấp            Lỗi theo công đoạn               ▼
   DRAFT        →        QC_APPROVED        →     LOCKED → chấm điểm
```

**Ba luật cứng:** người khai ca không tự xác nhận phẩm chất của mình (KCS khác phải vào); chấm điểm chỉ chạy ở bước 3 khi con số chắc chắn; ca đã khoá là đóng băng, mở lại phải ghi lý do và xoá điểm cũ để chấm lại.

### Điểm 2 tầng (cuối = T1 × 0,6 + T2 × 0,4, chặn trần 150)

**Tầng 2 (40%) — kết quả chung ca:**
- Đạt chỉ tiêu sản lượng (35%): lấy thẳng % đạt, chặn trần 150
- Giữ định mức nguyên liệu (25%): hiệu suất định mức, chặn trần 150
- Phế phẩm & làm lại (25%): `100 − (tỷ lệ hỏng / 10%) × 100`; hỏng 10% → 0 điểm
- An toàn thực phẩm (15%): `100 − vi phạm × 50`; 2 vi phạm → 0 điểm

**Tầng 1 (60%) — phần riêng từng người:**
- Chất lượng công đoạn (50%): `100 − (tỷ lệ lỗi / 5%) × 100`
- Chuyên cần (25%): giờ làm thực tế / giờ đăng ký × 100, chặn 100
- Kỷ luật & an toàn cá nhân (25%): `100 − vi phạm × 34`; 3 vi phạm → 0 điểm

Nhân viên bấm vào tên mình xem đủ từng thành phần, điểm bao nhiêu, vì sao — không phải tin một con số từ trên trời.

### Chống chạy chỉ tiêu — ba luật tự động quét khi khoá

| Luật | Điều kiện | Xử lý |
| --- | --- | --- |
| Chạy sản lượng, phá NVL | Đạt chỉ tiêu **và** NVL > 8% định mức | Khoá thưởng |
| Giấu phế thành làm lại | Phế = 0 **và** làm lại > 4% thành phẩm | Khoá thưởng |
| Lệch cân đối | Lệch > 5 kg **hoặc** > 2% sản lượng | Khoá thưởng |

Phát hiện → khoá thưởng ca → quản đốc giải trình → Ban Giám đốc quyết. Thưởng chỉ mở **khi ca hết sạch cảnh báo**, không cái nào bị từ chối.

### Bảo mật theo trường dữ liệu

- Ban Giám đốc + Giám đốc Sản xuất: xem phần **quy ra tiền** (tổn thất VNĐ, đơn giá)
- Công nhân: xem số liệu ca và điểm của chính mình, không xem điểm người khác

### Nối sang KPI tháng

Mỗi lượt chạy nền, hệ thống gộp ca **đã khoá** trong tháng, quy về từng người rồi đẩy vào cột *Số hệ thống* của KPI tháng:

| Chỉ tiêu KPI tháng | Lấy từ ca sản xuất |
| --- | --- |
| `PROD_OUT` | Tổng khối lượng quy cho người đó |
| `PROD_DEFECT` | Lỗi công đoạn / khối lượng quy |
| `PROD_ONTIME` | % ca người đó tham gia mà ca đạt chỉ tiêu |
| `PROD_SAFE` | Tổng vi phạm cá nhân trong tháng |

Số này đi qua **đúng bộ đối soát Phase 3**. Nếu công nhân tự khai lệch > 5% so với số máy tính ra, hệ thống treo lại chờ người quyết.

### Bắt đầu dùng

1. **Quản trị → Tài khoản**: gán vai trò xưởng (công nhân, tổ trưởng, quản đốc, KCS, GĐ Sản xuất)
2. **Xưởng sản xuất → Danh mục SKU**: khai chuẩn sản lượng & hao hụt định mức cho từng SKU
3. Cuối mỗi ca: tổ trưởng vào **Khai ca sản xuất**

> ⚠️ Ba SKU mẫu hiện để hao hụt 6–8% là **số tạm**, không phải định mức GANI thật. Chạy 1–2 tháng là có số thật để thay vào.

---

## 5f. Dashboard & Báo cáo KPI (Phase 3)

**Bảng điều hành tập trung** cho Ban Giám đốc và Quản trị xem tổng hợp điểm KPI theo thời gian thực.

### Dashboard KPI

Truy cập qua **Quản trị → KPI Dashboard** (CEO/ADMIN) hoặc `/admin/kpi-dashboard`.

**Tính năng:**

| Tính năng | Nội dung |
| --- | --- |
| **Bộ lọc kỳ** | Hôm nay / Tuần này / Tháng này |
| **Thẻ số tóm tắt** | Tổng ca, điểm trung bình, tổng thưởng, trung bình/ca, % đã duyệt |
| **Biểu đồ phân bố** | 6 khoảng điểm (0–50, 50–75, 75–90, 90–100, 100–120, 120+), thống kê (avg, median, độ lệch) |
| **Biểu đồ xu hướng** | 7 ngày gần nhất, trung bình động 3 ngày, tổng thưởng của kỳ |

**API endpoints:**

```bash
GET /api/kpi/dashboard/summary?period=today|week|month
GET /api/kpi/dashboard/distribution
GET /api/kpi/dashboard/trends?days=7|30|90
```

### Báo cáo KPI — chưa làm

Báo cáo thưởng ca chi tiết, báo cáo phê duyệt riêng, và xuất PDF/Excel cho
Dashboard này **chưa có** — mới dừng ở 3 API endpoint và giao diện tổng hợp ở
trên. Chưa có lịch cụ thể; làm khi nào có nhu cầu thật thì báo.

---

## 5g. Những gì Phase 4 thêm vào

Ba việc, tất cả đều là **đọc quá khứ để nói trước tương lai**. Vào menu
**Phân tích & Dự báo** (trưởng phòng và Ban Giám đốc mới thấy).

**1. Dự báo nguy cơ vỡ kế hoạch.** Mỗi việc đang mở được chấm một tỷ lệ "khả năng
kịp hạn". Cách tính: so tiến độ thực tế với tiến độ đáng lẽ phải có tính theo
lịch, rồi nhân với *nhịp làm việc* của chính người đang làm — lấy từ trung vị
của các việc người đó đã đóng. Ai hay trễ thì cùng một mức tiến độ vẫn bị dự báo
xấu hơn người hay đúng hạn.

**2. Cân bằng tải nhân sự.** Cộng giờ ước tính của việc đang mở theo từng người,
chia cho quỹ giờ tháng, ra mức tải %. Trên 115% là quá tải, dưới 60% là còn dư
sức. Hệ thống đề nghị chuyển việc từ người quá tải sang người dư sức, **chỉ trong
cùng phòng ban** (đúng luật cấm giao việc vượt cấp), và chỉ chuyển vừa đủ để kéo
người quá tải về mức bình thường — không dồn hết sang người khác.

**3. Phát hiện bất thường KPI.** Số nhân viên tự khai được so với lịch sử của
chính họ bằng hai thước: z-score thường và **thước bền MAD** — thước bền không bị
một tháng đột biến kéo lệch đi. Vượt ngưỡng thì gắn cảnh báo Theo dõi / Cảnh báo
/ Nghiêm trọng.

**Bốn nguyên tắc bắt buộc của Phase 4:**

- **Có bao nhiêu dữ liệu thì nói bấy nhiêu.** Mọi con số đều kèm `sampleSize` và
  `confidence`. Dưới 4 kỳ lịch sử thì **không kết luận bất thường**; dưới 5 việc
  đã đóng thì **không nói được nhịp làm việc** của người đó — màn hình ghi thẳng
  là chưa đủ dữ liệu chứ không đoán bừa.
- **Cảnh báo không tự trừ điểm.** Bất thường chỉ là dấu hiệu thống kê. Người bị
  nêu tên được giải trình, trưởng phòng hoặc Ban Giám đốc kết luận. Mọi bước đều
  vào nhật ký.
- **Điểm sức khoẻ là của hệ thống, không phải của AI.** Điểm tính bằng công thức
  cố định 5 thành phần có trọng số (xem `lib/analytics/constants.ts`). AI chỉ
  viết phần diễn giải; nếu AI có nói một con số khác thì con số đó bị bỏ.
- **Hệ thống tự chấm lại chính nó.** Mỗi lượt dự báo được lưu vào bảng
  `prediction_logs`. Việc đóng xong, cron so lại dự báo cũ với kết quả thật và
  báo độ chính xác — trong đó tách riêng loại sai nguy hiểm nhất: *báo là ổn
  nhưng cuối cùng lại trễ*. Tin hay không tin bộ dự báo, anh nhìn con số đó mà
  quyết.

---

## 6. Nối iPOS / CRM / ERP đẩy số tự động

### 6.1 Khai nguồn trong hệ thống

**Quản trị → Tích hợp → + Thêm nguồn**. Điền mã (ví dụ `ipos`), tên, loại, độ tin
cậy. Hệ thống sinh khoá bí mật và hiện **đúng một lần** — chép ngay đưa cho bên
kỹ thuật của họ.

### 6.2 Bên gửi phải gửi thế nào

```
POST http://<địa-chỉ-server>/api/integrations/ipos/webhook

Header:
  X-Timestamp: 1757280000
  X-Signature: sha256=<HMAC_SHA256("1757280000.<body>", khoá_bí_mật)>

Body:
[
  { "kpiCode": "SALES_REV",
    "employeeEmail": "nv.sales1@ganifoody.vn",
    "month": 9, "year": 2026,
    "value": 520000000 }
]
```

Chuỗi đem ký là `"<timestamp>.<body JSON nguyên văn>"`. Phải ký đúng từng byte của
body — parse ra rồi stringify lại là chữ ký sai ngay.

Ví dụ ký bằng Node.js cho bên kia tham khảo:

```bash
node -e "const c=require('crypto');const b=JSON.stringify([{kpiCode:'SALES_REV',employeeEmail:'nv.sales1@ganifoody.vn',month:9,year:2026,value:520000000}]);const t=Math.floor(Date.now()/1000);console.log('X-Timestamp:',t);console.log('X-Signature: sha256='+c.createHmac('sha256','KHOA_BI_MAT').update(t+'.'+b).digest('hex'));console.log('Body:',b)"
```

### 6.3 Những gì hệ thống chặn

| Tình huống | Kết quả |
| --- | --- |
| Thiếu hoặc sai chữ ký | 401, ghi vào nhật ký webhook |
| Gói tin cũ quá 5 phút (phát lại) | 401 |
| Nguồn chưa đăng ký | 404 |
| Nguồn đang tạm ngưng | 403 |
| Dòng KPI hoặc kỳ **đã chốt** | Bỏ qua, nhưng vẫn lưu dữ liệu thô |
| Lệch quá 5% so với nguồn khác | Treo lại ở bảng Đối soát, không ghi số nào |

Gửi được một bản ghi hoặc mảng tối đa 500. Kỳ chưa mở thì dữ liệu vẫn được lưu
thô để dùng sau.

Mất khoá thì vào **Quản trị → Tích hợp → Đổi khoá**. Khoá cũ chết ngay lập tức.

---

## 6b. Bật bot Telegram tương tác

Có bot thì Ban Giám đốc duyệt KPI ngay trong tin nhắn, không cần mở máy tính.

1. Làm xong bước 5 (bot token, `TELEGRAM_ENABLED="true"`).
2. Điền thêm vào `.env`:

   ```
   TELEGRAM_WEBHOOK_SECRET="chuỗi ngẫu nhiên dài"
   TELEGRAM_BOT_USERNAME="ten_bot_cua_cong_ty"
   ```

   Sinh chuỗi ngẫu nhiên:

   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```

3. Telegram chỉ gọi được vào địa chỉ **công khai có HTTPS**. Chạy trên máy thì
   dùng ngrok để mở một đường tạm:

   ```bash
   npx ngrok http 3000
   ```

4. Khai địa chỉ đó với Telegram:

   ```bash
   node -e "process.loadEnvFile('.env');fetch('https://api.telegram.org/bot'+process.env.TELEGRAM_BOT_TOKEN+'/setWebhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://DIA-CHI-NGROK/api/telegram/webhook',secret_token:process.env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message','callback_query'],drop_pending_updates:true})}).then(r=>r.json()).then(console.log)"
   ```

5. Mỗi người vào **Thông báo → Nối Telegram**, lấy mã 6 số, gõ `/start 123456`
   cho bot.

**Lệnh dùng được trong Telegram:**

| Lệnh | Ai dùng | Việc |
| --- | --- | --- |
| `/homnay` | mọi người | Việc tới hạn hôm nay và đã trễ, kèm nút báo xong |
| `/kpi` | mọi người | Điểm KPI kỳ gần nhất của mình |
| `/canhbao` | TP, BGĐ | Số việc báo động đỏ, việc trễ, ô KPI đang lệch |
| `/duyet` | TP, BGĐ | Số dòng KPI đang chờ mình |
| `/trogiup` | mọi người | Danh sách lệnh |
| `/huy` | mọi người | Ngắt nối tài khoản |

> **Về bảo mật:** thiết kế gốc xử lý nút bấm mà không kiểm tra người bấm là ai —
> tức ai gọi được vào webhook đều duyệt KPI được cho cả công ty. Bản này chặn ba
> lớp: khoá bí mật của Telegram, `from.id` phải khớp tài khoản đang hoạt động, và
> thao tác vẫn đi qua đúng hàm nghiệp vụ như trên web nên vẫn bị chặn quyền và
> vẫn ghi nhật ký. Có bài kiểm thử riêng cho từng lớp.

---

## 6c. Bật Zalo ZNS

Zalo chỉ cho gửi theo **mẫu đã được Zalo duyệt trước**, không gửi tự do như
Telegram. Muốn dùng thì phải có Zalo OA và đăng ký mẫu tin trước.

```
ZALO_ENABLED="true"
ZALO_ZNS_ACCESS_TOKEN="access token của Zalo OA"
ZALO_TEMPLATE_KPI_REMINDER="id mẫu nhắc hạn KPI"
ZALO_TEMPLATE_TASK_CRITICAL="id mẫu việc khẩn cấp"
ZALO_TEMPLATE_KPI_LOCKED="id mẫu KPI đã chốt"
```

Người nhận phải có số điện thoại trong hồ sơ (Quản trị → Tài khoản). Chưa cấu
hình thì hệ thống bỏ qua kênh này, không báo lỗi.

---

## 7. Kiểm thử

Unit test (không cần server, không cần database) — CI chạy cả hai múi giờ:

```bash
npm test
npm run test:tz
```

Smoke test (cần server đang chạy và database **local**; script tự từ chối chạy
nếu `APP_URL`/`DATABASE_URL` không phải localhost, trừ khi đặt
`ALLOW_REMOTE_TARGET=1`). Tài khoản seed phải đã đổi được mật khẩu hoặc tắt cờ
`mustChangePassword`; mật khẩu dùng để đăng nhập lấy từ `SMOKE_PASSWORD`
(mặc định `Gani@2026`):

```bash
npm run test:all
```

> **`test:all` dừng ngay khi một bộ có lỗi** (nối bằng `&&`) — bộ sau sẽ không
> chạy. Nếu Phase 1 báo lỗi thì Phase 2-3-4... chưa chắc đã chạy, đừng tưởng
> nhầm là "chỉ có 2 lỗi". Muốn biết toàn cảnh thì chạy riêng từng bộ theo lệnh
> ở cuối mục này.

> **Kết quả xác nhận gần nhất (09/09/2026, trên database Postgres/Supabase,
> sau khi tách project dev riêng theo mục 8c):**
> Phase 1 **16/18** (2 lỗi là lỗi của chính bài test — chọn ngẫu nhiên một dòng
> KPI không xác định chiều cao/thấp tốt, đã xác minh logic tính điểm thật đúng
> qua gọi API trực tiếp), Phase 2 **35/35**, Phase 3 **38/38**, KPI Sản xuất
> **43/43**. Phase 4 phát hiện **lỗi seed data thật** (đã sửa) và ban đầu tưởng
> có lỗi ở phần phát hiện bất thường KPI, nhưng soát lại (09/09/2026) thì hoá
> ra là **lỗi trong chính bài kiểm thử** (đọc kết quả trước khi tự kích hoạt
> bước quét) — đã vá bài test, đối chiếu dữ liệu thật xác nhận công thức tính
> đúng, xem mục 10. Vận hành và Bảng điều hành **chưa được chạy lại** trên
> Postgres kể từ khi khôi phục schema — chạy trước khi tin tưởng hoàn toàn.

**304 phép thử** bám đúng bảng test case trong tài liệu thiết kế:

- **Phase 1 (18 phép thử)** — chặn giao việc vượt cấp, trần điểm 150%, khoá theo
  hạn ngày 2, phát hiện lệch số liệu, nhật ký khi sửa điểm đã chốt, phạm vi dữ
  liệu theo vai trò.
- **Phase 2 (35 phép thử)** — bóc tách câu lệnh, gắn cờ CẦN XÁC NHẬN khi thiếu
  thông tin, chặn câu lệnh chèn, AI không tạo được việc nếu không có người duyệt,
  duyệt đề xuất vẫn bị chặn nếu giao vượt cấp, chấm điểm quá tải và mắt xích gãy,
  chặn vòng lặp phụ thuộc, cố vấn KPI không vượt trần và không chạm vào bảng điểm.
- **Phase 3 (38 phép thử)** — chữ ký webhook (sai/thiếu/phát lại đều bị chặn),
  đối soát khớp thì đồng bộ lệch thì treo, chốt số bắt buộc có lý do, kỳ đã chốt
  thì webhook không đụng được, đổi khoá thì khoá cũ chết ngay, bot Telegram chặn
  gói tin giả mạo và chặn sai vai trò, mã nối tài khoản dùng một lần.

- **KPI Sản xuất (43 phép thử)** — luồng 3 bước không nhảy cóc, không tự duyệt
  phần mình khai, bắt buộc lý do khi đặt chỉ tiêu khác chuẩn SKU, công thức 2 tầng
  đúng đến từng số lẻ, đủ 3 luật chống chạy chỉ tiêu, khoá và mở thưởng đúng điều
  kiện, công nhân không xem được tiền, cầu nối sang KPI tháng chạy được.

- **Phase 4 (51 phép thử)** — mọi dự báo đều khai nền dữ liệu, người chưa có lịch
  sử thì nói thẳng là chưa đủ để kết luận, việc chậm bị chấm thấp hơn việc bám kế
  hoạch, gợi ý san việc chỉ chuyển vừa đủ và không phá luật cấm giao vượt cấp,
  bắt được khai báo đột biến 3,2 lần nhưng không kết luận khi lịch sử mỏng, điểm
  sức khoẻ do hệ thống tính chứ không phải AI chấm, hệ thống tự chấm lại độ chính
  xác của chính nó, nhân viên không mở được phần phân tích và trưởng phòng không
  đọc trộm được phòng khác qua tham số URL.

- **Vận hành (57 phép thử)** — đổi mật khẩu (sai mật khẩu cũ, mật khẩu yếu, đặt
  lại đúng mật khẩu mẫu, trùng mật khẩu cũ đều bị chặn; gửi kèm `userId` người
  khác cũng chỉ đổi được của chính mình), nạp nhân sự Excel (sai một dòng là từ
  chối cả file, không tạo được tài khoản ADMIN/CEO bằng Excel, bắt email trùng
  trong file lẫn trùng với người đã có), sao lưu (bản sao mở được và đủ dữ liệu).

- **Bảng điều hành (62 phép thử)** — thanh nhịp kỳ KPI khớp luật khoá thật, hàng
  chờ xếp khoá-cứng-trước, việc trễ tách khỏi việc hôm nay, và quan trọng nhất:
  **không vai trò nào bị trỏ tới trang mà họ sẽ bị đá ngược ra** — bài kiểm thử
  quét mọi `href` trên trang rồi đối chiếu với danh sách trang bị chặn của từng
  vai trò, và kiểm ngược lại rằng những trang đó thật sự chặn.

Chạy riêng từng bộ: `npm run test:smoke`, `npm run test:phase2`, `npm run test:phase3`, `npm run test:production`, `npm run test:phase4`, `npm run test:ops`, `npm run test:dashboard`.

> Bộ kiểm thử có ghi vào database. Chạy trên máy thử thì được, **đừng chạy trên hệ thống đang dùng thật**.

---

## 7b. Ba việc vận hành

Không phải tính năng nghiệp vụ, nhưng thiếu chúng thì không đưa hệ thống vào dùng
thật được.

### Mật khẩu

Nhân viên tự đổi mật khẩu ở **Đổi mật khẩu** trong menu, hoặc vào thẳng
`/doi-mat-khau`. Phải nhập mật khẩu đang dùng để xác nhận — kể cả khi máy đang mở
sẵn phiên đăng nhập, để ai đó ngồi vào máy người khác cũng không chiếm được tài khoản.

Luật đặt mật khẩu nằm ở một chỗ duy nhất, `lib/password.ts`: tối thiểu 10 ký tự,
có cả chữ và số, không khoảng trắng, không chứa tên hoặc email của chính mình,
không phải mật khẩu mẫu. **Cả ba đường tạo mật khẩu đều đi qua luật này** — người
tự đổi, quản trị đặt hộ, và nạp hàng loạt từ Excel. Ba đường mà ba luật khác nhau
thì luật chặt nhất thành vô nghĩa: người ta chỉ cần đi vòng qua đường lỏng nhất.

**Quản trị đặt mật khẩu hộ ai thì người đó bị bắt tự đổi ngay lần đăng nhập sau.**
Áp dụng cho cả tài khoản mới tạo và tài khoản vừa được đặt lại. Cho tới khi họ tự
đặt, mọi trang đều đá họ về trang đổi mật khẩu. Kết quả cuối cùng: quản trị không
giữ mật khẩu của ai cả.

Nhật ký ghi cả lần đổi thành công lẫn **lần thử hỏng vì sai mật khẩu hiện tại** —
dấu hiệu có người đụng vào máy người khác. Nhật ký không bao giờ chứa mật khẩu.

### Nạp nhân sự hàng loạt

**Quản trị → Tài khoản → Tải file mẫu**, điền, rồi **Chọn file để nạp**.

Luật ở đây ngược với phần nạp số KPI: **sai một dòng là từ chối cả file, không tạo
ai hết.** Nạp số KPI thì dòng nào được cứ nhận, vì thiếu một con số bổ sung sau
được. Còn nạp nhân sự nửa chừng thì có người đã có tài khoản, có người chưa, mà
nhìn vào file không phân biệt được — nạp lại lần hai sẽ đẻ ra một mớ lỗi "email đã
tồn tại" lẫn với lỗi thật.

Máy liệt kê **đủ** các dòng sai và sai vì sao, để sửa một lượt.

Hai thứ file Excel **không** làm được:
- Không tạo được tài khoản `CEO` hoặc `ADMIN`. Hai vai trò này phải tạo tay trong
  mục Quản trị — tạo quyền cao nhất hệ thống bằng một dòng Excel là đường leo
  thang quyền quá dễ.
- Không lách được luật mật khẩu. Mật khẩu tạm yếu thì cả file bị từ chối.

Mọi người nạp vào đều bị bắt tự đổi mật khẩu, vì mật khẩu tạm nằm trong file mà
nhiều người xem được.

### Sao lưu

**Production:** GitHub Actions (`.github/workflows/backup.yml`) chạy `pg_dump`
mỗi đêm, mã hoá bằng `BACKUP_PASSPHRASE` rồi lưu thành artifact 30 ngày. Xem mục
0 bước 7 để bật. Muốn giữ lâu hơn thì định kỳ tải bản đầu tháng về cất riêng.

**Chạy tay** (cần PostgreSQL client cùng phiên bản lớn với server):

```bash
npm run backup
```

Bản sao ra thư mục `backups/` dạng `pg_dump --format=custom`, đọc từ `DIRECT_URL`
(cổng 5432 — pooler 6543 không chạy được pg_dump). Quy tắc giữ: **14 bản gần nhất
+ bản đầu tiên của mỗi tháng**.

**Khôi phục** vào một database TRỐNG (đừng đè thẳng production):

```bash
pg_restore --no-owner --no-privileges -d "<url database đích>" backups/kpi-YYYYMMDD-HHmm.dump
```

Bản từ GitHub Actions phải giải mã trước: `gpg --decrypt file.dump.gpg > file.dump`.

---

## 7c. Bảng điều hành xếp theo cái gì

Nguyên tắc: **nêu thứ bất thường, không kể lại mọi thứ bình thường.** Thứ tự từ
trên xuống là thứ tự cấp bách, không phải thứ tự phòng ban.

### 1. Thanh nhịp kỳ KPI

Ba cửa của tháng vẽ thành một dải: đã đóng (xám), đang mở (vàng, kèm đếm ngược),
chưa tới (nhạt). Nằm trên cùng vì đây là **thông tin duy nhất trên trang có hậu
quả không đảo ngược được** — việc trễ hạn thì làm bù được, còn cửa KPI đóng lúc
23:59 là khoá thật.

Quản trị không thấy khối này: họ không có KPI.

### 2. Hàng chờ hành động

Thay cho việc chỉ bày ra bốn con số. Thẻ số nói *bao nhiêu*; hàng chờ nói *làm
gì, trước khi nào, bấm vào đâu*.

Luật xếp thứ tự (`dashboard-service.ts`): **khoá cứng trước, rồi tới hạn gần
trước.** Không xếp thuần theo thời gian, vì việc trễ 4 ngày sẽ luôn đứng trên cửa
KPI đóng tối nay — mà việc trễ thì làm bù được.

Cắt ở 5 dòng. Quá 5 thì nó thành một danh sách việc thứ hai và người ta bắt đầu
bỏ qua. Hàng chờ sạch thì co lại một dòng xanh.

### 3. Thẻ số có mốc so sánh

`18 việc đang mở` tự nó không nói gì; `18, giảm 3 so tuần trước` mới là thông tin.
Mốc "một tuần trước" **dựng lại từ dấu thời gian** chứ không đọc bản chụp — hệ
thống không lưu chuỗi thời gian của số việc (xem chú thích `existedAWeekAgo`).

Đã bỏ thẻ *"Xong trong tháng"*: nó chỉ tăng, không bao giờ đòi ai làm gì.

### 4. Việc trễ tách khỏi việc hôm nay

Trước đây trộn chung một danh sách sắp theo điểm rủi ro. Việc trễ 4 ngày và việc
còn 9 tiếng là hai tình huống khác hẳn nhau về cách xử.

Mỗi dòng rút từ ~100px xuống ~56px: bỏ thanh tiến độ ngang, chuyển màu trạng thái
thành vệt dọc bên trái. Đổi lại là mất thanh tiến độ nhìn được — chấp nhận, vì ở
đây người ta lọc xem việc nào cần mở ra chứ không đọc tiến độ.

### 5. Ba bộ máy Phase 4 lên bảng điều hành

Dự báo vỡ kế hoạch, cân bằng tải và bất thường KPI trước đây chỉ nằm trong mục
Phân tích. Giữ nguyên tính trung thực của tầng dưới: mỗi cảnh báo ghi rõ dựa trên
bao nhiêu mẫu và độ tin cậy nào.

### Một lỗ hổng vá kèm: nhân viên không có chỗ giải trình

API cho nhân viên tự giải trình cảnh báo bất thường **từ đầu**, và Phase 4 có kiểm
thử hẳn hoi. Nhưng màn hình duy nhất làm việc đó nằm trong `/analytics`, mà trang
đó đá cả nhân viên lẫn quản trị về `/dashboard`. Nghĩa là **chưa từng có nhân viên
nào giải trình được**.

Nay ô giải trình nằm ngay cuối bảng điều hành của chính họ. Bài kiểm thử đi hết
đường đó: hiện ô → gửi giải trình → cảnh báo đổi trạng thái → ô biến mất.

> Bài học rút ra và đã thành một phép thử riêng: mỗi `href` trên bảng điều hành
> đều được đối chiếu với danh sách trang bị chặn của từng vai trò, rồi kiểm ngược
> lại rằng những trang đó thật sự chặn. Bảng điều hành gom đường dẫn từ khắp hệ
> thống nên là chỗ dễ đẻ ra nút bấm quay vòng nhất.

### 6. Nhịp xưởng — chỉ Admin và Ban Giám đốc

Hai người này không đứng trong xưởng hằng ngày, nên thêm một khối riêng ngay
đầu trang: **Nhân lực hôm nay** (số người có mặt trong ít nhất một ca sản xuất
hôm nay, đếm theo người chứ không theo lượt ca — một người làm cả ba ca vẫn chỉ
tính một) và **Sản lượng** từ đầu tháng tới hôm nay.

Sản lượng chỉ cộng phần **đã qua KCS xác nhận** (`qcPassedKg`), không cộng số thô
tự khai (`rawOutputKg`) — đúng quy ước đã có sẵn ở trang Xưởng sản xuất, nơi cột
"đạt" hiện dấu gạch ngang cho tới khi KCS xác nhận. Số thô là lời tự khai, chưa
ai kiểm; đưa lên trang chủ dưới danh nghĩa "sản lượng" mà chưa ai xác minh thì
sai bản chất con số. Còn bao nhiêu ca trong tháng chưa được xác nhận thì nói
thẳng ra bằng chữ ("còn N ca chờ xác nhận") — im lặng bỏ qua sẽ khiến sản lượng
trông đủ hơn thực tế.

Trưởng phòng và nhân viên không thấy khối này — họ đã có mục **Xưởng sản xuất**
riêng cho việc đó.

Nền hai thẻ lấy đúng màu logo GANI B2B, đo trực tiếp từ điểm ảnh file
`logo GANI.png` (chữ "GANI" `#1E89CA`, lá `#3BA548`) chứ không dùng xanh dương/
xanh lá chung chung của Tailwind. Ba sắc độ mỗi màu — nền, viền, chữ — tính bằng
HSL giữ nguyên tông, chỉ đổi độ sáng, để chữ trên nền luôn đạt tỉ lệ tương phản
trên 5:1 (chuẩn AA đòi 4,5:1 cho chữ nhỏ). Xem hằng số `SURFACE` trong
`components/ui.tsx`.

### Admin xem được KPI mọi phòng ban

Trước đây menu của Admin không có mục **KPI** — dù tầng dịch vụ đã cho phép Admin
xem toàn bộ phòng ban từ lâu (`kpiScopeWhere` trả `{}` cho cả CEO lẫn ADMIN, y hệt
lỗ hổng "API có nhưng không có màn hình" ở mục giải trình bên trên). Nay đã thêm
một dòng vào menu, không đụng gì ở tầng dịch vụ.

---

## 8. Đưa lên mạng cho nhân viên dùng

**Đã làm xong.** Hệ thống đang chạy thật tại:

- **App**: `gani-kpi-system.vercel.app` (Vercel, vùng Singapore `sin1`)
- **Database**: PostgreSQL trên Supabase (region `ap-southeast-1`, Singapore)
- **Cron nền**: cron-job.org gọi `POST /api/cron/run` mỗi 2 tiếng

Các bước đã thực hiện, ghi lại để làm lại được cho môi trường khác (VD: xưởng thứ hai, công ty con) hoặc khi cần build lại từ đầu:

1. Tạo project PostgreSQL trên Supabase (bản miễn phí đủ cho 20–150 người). **Chọn region gần Việt Nam** (Singapore) — xem cái bẫy vùng miền bên dưới.
2. Sửa `prisma/schema.prisma`: `provider = "sqlite"` → `provider = "postgresql"`, thêm `directUrl = env("DIRECT_URL")`.
3. Điền `.env`: `DATABASE_URL` lấy từ Supabase mục **Connect → Transaction pooler** (cổng `6543`), `DIRECT_URL` lấy từ **Direct connection** (cổng `5432`).
4. Xoá lịch sử migration SQLite cũ (`rm -rf prisma/migrations`), chạy `npx prisma migrate dev --name init` để tạo lịch sử mới cho Postgres, rồi `npm run db:seed`.
5. Đổi `JWT_SECRET`, `CRON_SECRET`, `IPOS_WEBHOOK_SECRET` sang chuỗi mới, đặt `APP_URL` thành domain thật.
6. Push code lên GitHub, import repo vào Vercel, dán toàn bộ `.env` vào Environment Variables.
7. Trỏ **cron-job.org** vào `POST /api/cron/run` kèm header `x-cron-secret: <CRON_SECRET>`, lịch mỗi 2 tiếng.

### Hai cái bẫy đã gặp khi làm thật — nhớ để tránh lại

**Bẫy 1 — `prepared statement "s0" already exists`.** Supabase Transaction Pooler (cổng `6543`) không tương thích cách Prisma dùng prepared statement mặc định. Sửa: thêm `?pgbouncer=true` vào cuối `DATABASE_URL` (chỉ biến này, không phải `DIRECT_URL`).

**Bẫy 2 — 504 timeout ở `/api/cron/run`.** Mặc định Vercel chạy hàm ở Mỹ (`iad1`), trong khi database ở Singapore — mỗi lượt gọi Postgres phải vòng qua Thái Bình Dương, cộng dồn 7 bước tuần tự thì vượt quá thời gian cho phép. Sửa hai chỗ:
- `vercel.json` ở gốc dự án: `{ "regions": ["sin1"] }` — ép mọi hàm chạy gần database.
- `export const maxDuration = 60;` trong `app/api/cron/run/route.ts` — gói Hobby cho tối đa 60 giây, mặc định chỉ 10 giây.

---

## 8b. Muốn sửa hoặc nâng cấp app thì làm ở đâu

### Sửa nội dung nghiệp vụ (không đụng code)

| Muốn đổi gì | Vào đâu |
| --- | --- |
| Thêm/sửa chỉ tiêu KPI phòng ban | `/admin` → tab **Danh mục KPI** (chỉ ADMIN) |
| Thêm/sửa chuẩn SKU sản xuất (sản lượng, hao hụt, đơn giá) | `/production/skus` (CEO / ADMIN / Giám đốc Sản xuất) |
| Đổi mật khẩu, bật/tắt Telegram, Zalo, đổi secret | Vercel Dashboard → **Environment Variables**, sau đó Redeploy |

> **Lỗ hổng còn treo:** bộ "6 chỉ tiêu" tính thưởng ca sản xuất (`KpiConfig` — Sản Lượng/Hao Hụt/Chất Lượng/Đúng Spec/An Toàn/Deadline) **chưa có giao diện quản trị**, chỉ nạp qua `prisma/seed.ts` (file này chưa gắn vào `npm run setup`). Muốn đổi trọng số/chỉ tiêu của bộ này phải sửa thẳng database hoặc nhờ dựng thêm màn hình quản trị.

### Sửa tính năng, giao diện, luồng hoạt động (đụng code)

Vòng lặp làm việc:

```
Sửa code local  →  npm run dev kiểm tra tại chỗ  →  git commit + push  →  Vercel tự deploy
```

1. Thư mục nguồn duy nhất: `E:\GANI BRAINSTORM\kpi-system`. Sửa ở đây — tự làm hoặc mở lại Claude Code trỏ vào đúng thư mục này.
2. `npm run dev`, mở `localhost:3000` kiểm tra trước khi đưa lên thật.
3. `git add` → `git commit` → `git push` — Vercel thấy nhánh `master` có commit mới là tự build và deploy lại, không cần bấm gì thêm trên Vercel (trừ khi đổi biến môi trường).

**Nếu thay đổi đụng tới cấu trúc database** (thêm bảng, thêm cột): chạy `npx prisma migrate dev` để sinh file migration mới *trước khi* push — bước này nên nhờ xử lý cùng, vì sai sót ở đây từng gây ra cả một đợt phải khôi phục lại 13 bảng lệch schema (xem mục 10).

Repo: **[github.com/hungmk88/gani-kpi-system](https://github.com/hungmk88/gani-kpi-system)** (private).
Push cần Personal Access Token (Settings → Developer settings → Personal access
tokens trên GitHub) — tạo mới mỗi lần cần, xoá ngay sau khi dùng xong.

---

## 8c. Tách database dev/test khỏi database production

**Không bao giờ chạy `npm run test:all` (hay bất kỳ bộ `test:*` nào) khi `.env`
đang trỏ vào database production.** Các bộ test tự ghi và tự xoá dữ liệu — chạy
nhầm vào database thật sẽ đụng đến tài khoản, KPI, nhật ký đang phục vụ người
dùng thật.

Cách an toàn: dựng một project Supabase **thứ hai**, chỉ dùng cho máy dev/test,
tách hẳn khỏi project phục vụ `gani-kpi-system.vercel.app`:

1. Supabase → **New project** → đặt tên có hậu tố `-dev` để khỏi nhầm (vd
   `gani-kpi-system-dev`), cùng region Singapore.
2. Lấy 2 chuỗi kết nối y hệt mục 8 bước 3 (Transaction pooler + Direct
   connection), điền vào `.env` **trên máy dev** — không đụng gì đến biến môi
   trường trên Vercel, hai nơi cấu hình hoàn toàn tách biệt.
3. `npx prisma migrate deploy` rồi `npm run db:seed` để dựng dữ liệu mẫu trên
   project dev.
4. Giờ `npm run dev` và mọi lệnh `npm run test:*` đều an toàn — chạy trên
   project dev, không chạm gì đến production.

> Nếu mật khẩu database có ký tự đặc biệt (`@`, `#`, `%`...), phải percent-encode
> khi nhét vào chuỗi kết nối — riêng `@` gõ thành `%40`, nếu không hệ thống đọc
> sai vị trí ngăn cách user/host. Supabase có nhắc điều này ngay dưới ô chuỗi
> kết nối.

---

## 9. Bản đồ mã nguồn

```
kpi-system/
├── prisma/
│   ├── schema.prisma          35 bảng: nhân sự, công việc, KPI, sản xuất, tích hợp, đối soát, dự báo, nhật ký
│   ├── seed-history.mjs       dựng 6 kỳ KPI cũ + việc đã đóng làm nền cho dự báo
│   ├── seed.mjs               dữ liệu khởi tạo GANI FOODY
│   └── dev.db                 database SQLite (không đưa lên git)
├── lib/
│   ├── constants.ts           ★ mọi quyết định của Ban Giám đốc nằm ở đây
│   ├── kpi.ts                 công thức tính điểm, trần 150%, đối soát lệch số
│   ├── rbac.ts                ma trận phân quyền + luật cấm giao việc vượt cấp
│   ├── risk.ts                chấm điểm rủi ro 0–100 (kể cả quá tải, mắt xích gãy)
│   ├── gantt.ts               dựng Gantt + tính đường găng CPM + chặn vòng lặp
│   ├── auth.ts                đăng nhập, JWT trong cookie HttpOnly
│   ├── password.ts            ★ luật đặt mật khẩu — một chỗ duy nhất cho mọi đường
│   ├── excel-users.ts         file mẫu + bộ đọc danh sách nhân sự
│   ├── audit.ts               ghi nhật ký không xoá được
│   ├── telegram-api.ts        lớp gọi Bot API (dùng chung)
│   ├── telegram.ts            cảnh báo đỏ cho Ban Giám đốc
│   ├── telegram-bot.ts        bot tương tác: nút duyệt KPI, lệnh chat, nối tài khoản
│   ├── notify.ts              cổng thông báo đa kênh (ứng dụng + Telegram + Zalo)
│   ├── zalo.ts                cổng Zalo ZNS
│   ├── integrations/
│   │   └── signature.ts       ★ xác minh HMAC SHA256 + chống phát lại gói cũ
│   ├── production/
│   │   ├── constants.ts       ★ MỌI con số của KPI xưởng — sửa ở đây là xong
│   │   ├── kpi-engine.ts      công thức 2 tầng, thuần tính toán, không chạm DB
│   │   ├── anti-gaming.ts     ba luật phát hiện chạy chỉ tiêu
│   │   └── bridge.ts          gộp ca đã khoá thành số liệu KPI tháng
│   ├── excel.ts               file mẫu nhập số, đọc file nạp, xuất báo cáo
│   ├── analytics/
│   │   ├── constants.ts       ★ ngưỡng dữ liệu tối thiểu, trọng số điểm sức khoẻ
│   │   └── engine.ts          dự báo, tải nhân sự, bất thường — thuần toán, không chạm DB
│   ├── ai/
│   │   ├── provider.ts        gọi Gemini + tầng 1 làm sạch + tầng 2 ép JSON
│   │   ├── task-parser.ts     đọc câu lệnh thành việc (Gemini hoặc luật cứng)
│   │   ├── kpi-advisor.ts     cố vấn KPI, tách bạch số thật và phần suy đoán
│   │   └── executive-advisor.ts  báo cáo điều hành — điểm lấy của hệ thống, AI chỉ diễn giải
│   └── services/
│       ├── task-service.ts    ★ nơi DUY NHẤT tạo công việc — mọi đường đều qua đây
│       ├── kpi-service.ts     luồng duyệt 3 cấp + cron khoá 2-4-5
│       ├── risk-service.ts    quét rủi ro định kỳ
│       ├── ai-service.ts      tầng 3: người quyết định, ghi bảng ai_suggestions
│       ├── integration-service.ts  cổng nhận dữ liệu từ hệ thống bên ngoài
│       ├── reconciliation-service.ts  ★ đối soát đa nguồn, lệch thì treo lại
│       ├── reminder-service.ts     nhắc hạn, chặn nhắc trùng trong ngày
│       ├── analytics-service.ts    ★ dự báo, cân tải, bất thường + tự chấm lại dự báo cũ
│       ├── user-import-service.ts  nạp nhân sự hàng loạt — sai một dòng là từ chối cả file
│       ├── dashboard-service.ts    ★ gom dữ liệu bảng điều hành + luật xếp hàng chờ
│       └── production-service.ts   luồng duyệt ca 3 bước + chấm điểm + giải trình
├── app/
│   ├── doi-mat-khau/          trang đổi mật khẩu (nằm ngoài (app) để khỏi tự đá chính nó)
│   ├── (app)/                 các trang sau đăng nhập
│   │   ├── dashboard/         trang chủ theo vai trò — xếp theo mức cấp bách
│   │   ├── tasks/             Kanban, danh sách, Gantt, Lịch, trợ lý giao việc
│   │   ├── requests/          yêu cầu liên phòng ban
│   │   ├── kpi/               bảng KPI và luồng duyệt
│   │   ├── ceo/               bảng điều hành ngoại lệ
│   │   ├── reconciliation/    bảng chốt số khi các nguồn đá nhau
│   │   ├── production/        khai ca, KCS duyệt, BGĐ khoá, cảnh báo, SKU
│   │   ├── analytics/         phân tích & dự báo, cảnh báo bất thường, báo cáo điều hành
│   │   ├── audit/             nhật ký hệ thống
│   │   ├── admin/             quản trị + kpi-dashboard (Phase 3)
│   │   └── notifications/
│   ├── reports/               báo cáo điều hành bản in (xuất PDF)
│   └── api/                   40 endpoint REST
├── components/
│   ├── ui.tsx                 primitive dùng chung: thẻ số, nhãn, thanh tiến độ, cột mini
│   ├── dashboard.tsx          ★ thanh nhịp kỳ, hàng chờ, dòng việc gọn, ô giải trình
│   ├── anomaly-actions.tsx    ô giải trình bất thường — dùng chung Phân tích và Bảng điều hành
│   └── shell.tsx              khung thanh bên + menu ☰ trên điện thoại
├── scripts/
│   ├── scheduler.mjs          bộ máy chạy nền
│   ├── backup.mjs             ★ sao lưu database bằng VACUUM INTO + dọn bản cũ
│   ├── smoke-test.mjs         18 phép thử nghiệp vụ Phase 1
│   ├── smoke-test-phase2.mjs  35 phép thử nghiệp vụ Phase 2
│   ├── smoke-test-phase3.mjs  38 phép thử nghiệp vụ Phase 3
│   ├── smoke-test-production.mjs  43 phép thử KPI xưởng sản xuất
│   ├── smoke-test-phase4.mjs  51 phép thử phân tích & dự báo
│   ├── smoke-test-operations.mjs  57 phép thử ba việc vận hành
│   └── smoke-test-dashboard.mjs   49 phép thử bảng điều hành + quét link chết
└── docs/
    ├── HUONG-DAN-SU-DUNG.md   hướng dẫn cho người dùng cuối
    ├── KPI-SAN-XUAT.md        ★ công thức KPI xưởng — anh soát file này
    ├── PHAN-TICH-DU-BAO.md    ★ công thức Phase 4 và ngưỡng dữ liệu tối thiểu
    └── API.md                 tài liệu API cho bên tích hợp
```

---

## 10. Những gì hệ thống CHƯA có

Nói thẳng để không nhầm lẫn khi nghiệm thu. Cả bốn Phase của tài liệu thiết kế
đều đã chạy được. Những gì còn thiếu là **thao tác vận hành**, không phải mã nguồn:

**Phần Phase 4 cần thời gian mới đủ tin**
- Ba engine đọc quá khứ để đoán tương lai, nên **tháng đầu tiên chúng sẽ nói
  "chưa đủ dữ liệu" ở nhiều chỗ** — đó là hành vi đúng, không phải lỗi. Sau
  khoảng 4–6 kỳ KPI thật và vài chục việc đã đóng thì số mới có nghĩa.
- Độ chính xác của bộ dự báo **chưa được kiểm chứng bằng dữ liệu thật của xưởng**.
  Hệ thống tự báo con số đó trong màn hình Phân tích; đừng tin bộ dự báo trước khi
  nhìn nó.
- Giờ ước tính của mỗi việc hiện phần lớn **suy ra từ mức ưu tiên** chứ chưa phải
  số người thật điền. Bộ cân bằng tải có ghi rõ điều này ở cột độ tin cậy — muốn
  chuẩn hơn thì khi giao việc phải điền giờ.
- ✅ **Bộ phát hiện bất thường KPI — đã tìm ra nguyên nhân (09/09/2026): không
  phải lỗi công thức.** `npm run test:phase4` từng báo severity/sampleSize/
  confidence đều `undefined` vì **chính bài kiểm thử đọc bảng `kpiAnomaly`
  trước khi tự kích hoạt bước quét** (`/api/cron/run`) — nó chỉ đúng khi tình
  cờ có `npm run scheduler` chạy song song ở cửa sổ khác kịp quét trước. Đã vá
  `scripts/smoke-test-phase4.mjs` để tự gọi quét trước khi đọc kết quả, không
  phụ thuộc tiến trình nền nào khác. Đối chiếu trực tiếp database dev xác nhận
  công thức tính đúng: dòng bất thường của "huy" đã có sẵn
  `severity: CRITICAL, sampleSize: 6, confidence: HIGH` — khớp chính xác điều
  bài test mong đợi. **Chưa chạy lại toàn bộ `npm run test:phase4` để lấy kết
  quả xanh mới** (cần server chạy tại chỗ, việc này để anh làm khi tiện) —
  nhưng đối chiếu dữ liệu thật cho thấy cột "Bất thường" trên Bảng điều hành /
  Phân tích đáng tin trở lại.

**Phần Phase 3 — Dashboard & Báo cáo**
- ✅ **Dashboard KPI sẵn sàng** — trang `/admin/kpi-dashboard` với 3 API endpoint (summary, distribution, trends). Phục vụ CEO/ADMIN xem tổng hợp điểm theo thời gian thực.
- ✅ **Báo cáo PDF/Excel** — xong (09/09/2026). Nút "📊 Tải Excel" (`lib/excel.ts` → `buildDashboardReport`) và "🖨 Xuất PDF" (`/reports/kpi-dashboard`, in từ trình duyệt như báo cáo KPI) ngay trên trang Dashboard.
- ⏳ **Heatmap & Analytics** — ghi lại chờ phù hợp mới làm (xem mục "Việc đã ghi lại chờ làm sau" bên dưới) — bị giới hạn vì hệ thống chỉ có 3 ca cố định (Sáng/Chiều/Tối), không có dữ liệu theo khung giờ liên tục.
- 🔴 **Lỗi vỡ trang đã tìm thấy và vá (09/09/2026, xem ghi chú lịch sử bên dưới):** `/admin/kpi-dashboard` bị crash trắng trang khi 30 ngày gần nhất chưa có ca nào — đã sửa.

**Phần Phase 3 — Tích hợp chưa chạy thật**
- Cổng iPOS đã sẵn sàng nhận, nhưng **chưa ai đấu đầu bên iPOS vào**. Cần bên kỹ
  thuật của họ ký HMAC theo mục 6.2.
- Zalo ZNS đã viết xong nhưng **chưa đăng ký mẫu tin với Zalo**, nên chưa gửi
  được. Cần có Zalo OA trước.
- Bot Telegram giờ **đã có địa chỉ công khai HTTPS thật** (`gani-kpi-system.vercel.app`,
  không cần ngrok nữa) — chỉ còn thiếu bật `TELEGRAM_ENABLED="true"` và làm nốt
  mục 6b (setWebhook) khi anh muốn dùng.

**Bộ tính thưởng ca sản xuất "6 chỉ tiêu" — ĐÃ có giao diện quản trị (09/09/2026)**
- ✅ Tab **"6 chỉ tiêu"** trong `/admin` — sửa trọng số/chỉ tiêu giao/đơn vị/nguồn số liệu qua giao diện, không cần đụng database hay file seed nữa. `lib/kpi-calculator.ts` đọc thẳng từ `KpiConfig`, có hiệu lực ngay lần tính điểm ca kế tiếp. Bắt buộc ghi lý do khi sửa trọng số/chỉ tiêu giao, tự chặn nếu tổng 6 trọng số lệch 100%.
- Đã nạp đủ 6 dòng `KpiConfig` + 4 bậc `BonusConfig` vào cả database dev lẫn production (trước đó là 0 dòng ở production — bonus luôn ra 0đ dù tính điểm đúng, đã phát hiện và nạp kịp).

**Bốn tính năng mới thêm (10/09/2026), xem mục lịch sử dưới cùng để biết chi tiết kỹ thuật:**
- ✅ **Auto-báo cáo giao ban gửi Telegram BGĐ** — tự chạy đúng ngày chốt kỳ (ngày 5), không cần Gemini vẫn viết được (bản luật cứng).
- ✅ **KPI đa tầng cho thử việc/thời vụ** — `Quản trị → Tài khoản → Loại nhân sự`, trọng số 80/20 thay vì 60/40.
- ✅ **Kho NVL lý thuyết, tự trừ khi khoá ca** (mục 1 — Phần A) — `/production/raw-materials`. Phần B (đối soát MISA) vẫn chờ anh xác nhận bản MISA + OpenAPI.
- ⏳ **AI đọc phiếu KCS bằng Gemini Vision** (mục 5) — chưa code, chặn bởi việc chưa cấu hình `GEMINI_API_KEY`.

**Việc đã ghi lại chờ làm sau, chưa duyệt (10/09/2026):** giao diện PWA riêng cho khai ca trên di động; báo cáo Lương/Thưởng (payroll) quy đổi thẳng ra tiền — cần anh cho công thức lương thật; heatmap năng suất theo khung giờ; cảnh báo sớm nguy cơ nghỉ việc/burnout bằng AI (cố ý xếp cuối, rủi ro cao nhất vì đi ngược nguyên tắc "AI không tự phán con số" của Phase 4).

Một điểm cần nói rõ về *chấm điểm rủi ro*: nó chạy bằng luật cứng trong
`lib/risk.ts` chứ không gọi AI. Đây là lựa chọn có chủ đích — điểm rủi ro dùng để
xếp thứ tự việc trên bảng điều hành của Ban Giám đốc, nên phải ổn định và giải
thích được, không thể mỗi lần quét lại ra một con số khác.

**Ghi chú lịch sử — vụ lệch schema lớn (08/09/2026):** trước khi lên production,
phát hiện 13 model trong `schema.prisma` bị lệch hoàn toàn so với code service
thật (viết cho một thiết kế dự kiến nhưng chưa từng migrate) — bao gồm cả
`Reconciliation`, `KpiResult`, `AuditLog`, `AiSuggestion`, `TelegramLink`,
`ProductSku`. Đã khôi phục đúng theo code qua 9 migration; kiểm chứng bằng
build sạch + Phase 2/3/KPI Sản xuất chạy 100% (116 phép thử). Nếu sau này gặp
lỗi kiểu "Property X does not exist on type" ở đâu đó chưa từng đụng tới,
nhiều khả năng là cùng một dạng lệch này — đối chiếu code service thật với
`schema.prisma` trước khi sửa vá tạm.

**Ghi chú lịch sử — field chết `actualValue` trong 2 script seed (09/09/2026):**
`seed.mjs` và `seed-history.mjs` đều được viết từ trước vụ khôi phục schema ở
trên, nên vẫn ghi dữ liệu vào `actualValue` — trường cũ đã bị thay bằng ba
trường `actualSystem`/`actualSelf`/`actualFinal`. Hậu quả: toàn bộ 60 dòng KPI
tháng hiện tại và 360 dòng lịch sử được seed ra **không có số liệu thật** ở
đúng chỗ ứng dụng đọc — kể cả trên **cả hai** database (dev lẫn production, vì
production được seed cùng lúc với cùng lỗi). Đã sửa 2 script và **backfill lại
trên cả dev lẫn production** (copy từ `actualValue` sang đúng cột: 360 dòng
lịch sử + 37-47 dòng kỳ hiện tại mỗi bên).

**Ghi chú lịch sử — mất dữ liệu tiếng Việt ở 1 file (09/09/2026):**
`app/(app)/tasks/[id]/dependencies-panel.tsx` từng có ký tự tiếng Việt bị thay
bằng `?` và ký tự thay thế U+FFFD **trước cả phiên làm việc này** — không phải
kiểu lỗi double-encoding có thể giải mã ngược (xem phần sửa `@ts-nocheck` ở
trên), mà là dữ liệu gốc đã mất thật, phải đọc ngữ cảnh viết lại bằng tay. Nếu
thấy trang nào hiện `?` xen giữa chữ hoặc ô vuông lạ, tìm bằng:
`grep -rlP "\xef\xbf\xbd" app/ components/ lib/` (chỉ khớp dữ liệu mất thật, an
toàn hơn tìm dấu `?` vì `?` xuất hiện khắp nơi trong code hợp lệ).

**Ghi chú lịch sử — rà soát trực tiếp trên production bằng trình duyệt (10/09/2026):**
Sau khi thêm 4 tính năng (auto-báo cáo giao ban, KPI thử việc, kho NVL, và loạt
sửa nhỏ khác), đã đăng nhập thật vào `gani-kpi-system.vercel.app` (không dùng
localhost) để kiểm tra thay vì chỉ tin vào build sạch. Hai phát hiện đáng nói:

1. **Lỗi thật, đã vá:** `/admin/kpi-dashboard` vỡ trắng trang (`TypeError:
   Cannot read properties of null (reading 'toFixed')`) khi 30 ngày gần nhất
   chưa có ca sản xuất nào — hàm tính trung vị trong
   `lib/services/kpi-dashboard.ts` gặp mảng rỗng thì ra `NaN`, JSON hoá thành
   `null`, màn hình gọi `.toFixed()` trên `null` thì vỡ. Lỗi có từ trước (kế
   thừa nguyên vẹn khi tách file), chỉ lộ ra vì production hiện chưa có
   `ShiftKpiScore` nào. Đã sửa: mảng rỗng thì trung vị = 0 thay vì tính ra NaN.
2. **⚠️ Đăng nhập thử bằng mật khẩu mẫu `Gani@2026` vào CẢ `ceo@ganifoody.vn`
   lẫn `admin@ganifoody.vn` đều THÀNH CÔNG trên production thật.** Hai tài
   khoản quyền cao nhất hệ thống vẫn chưa được đổi qua mật khẩu riêng — README
   đã nhắc việc này ở mục 1 từ đầu nhưng đến giờ xác nhận trực tiếp vẫn chưa
   làm. Vì mật khẩu này in công khai trong tài liệu, **nên đổi ngay**, đặc biệt
   hai tài khoản cao nhất.

Cũng nhận thấy: `/kpi` hiện đồng thời 2 kỳ "Đang mở" (Tháng 09/2026 VÀ Tháng
10/2026) — có thể là dữ liệu còn sót lại từ lúc dựng/seed nhiều lần trong
phiên làm việc trước, chưa xác minh có phải lỗi luồng khoá kỳ hay không; nêu ra
để anh để ý, chưa đủ căn cứ kết luận là bug.

**Ghi chú lịch sử — Vercel build vỡ suốt từ commit thêm `employmentType`
(10/09/2026), đã vá:** phát hiện qua chính rà soát ở trên — bấm vào production
thật thì cột "Loại nhân sự" và trang `/production/raw-materials` không có,
kiểm Vercel Dashboard mới thấy **mọi deploy từ lúc thêm mục 2 (KPI thử việc)
trở đi đều "Error"** sau 30-40 giây. Nguyên nhân: `package.json` chưa từng có
`"postinstall": "prisma generate"` — Vercel dùng lại `node_modules` cache với
Prisma Client cũ (sinh trước khi có `employmentType`), TypeScript báo
`Property 'employmentType' does not exist`. `npm run build` ở máy dev luôn
sạch vì máy dev tự chạy `prisma generate`/`migrate dev` ngay khi sửa schema —
Vercel thì không, nên **bản sạch cục bộ không đảm bảo Vercel build được**. Đã
thêm `postinstall` vào `package.json`. **Từ nay, mỗi lần đổi
`schema.prisma` xong phải vào Vercel Dashboard → Deployments kiểm tra deploy
có "Ready" thật không**, đừng chỉ tin build cục bộ.

**Ghi chú lịch sử — bật Gemini thật, model gốc đã chết + lỗi timeout ẩn
(10/09/2026):** anh đưa khoá Gemini thật, kiểm tra trực tiếp thì phát hiện 2
việc:

1. **Model gốc `gemini-2.0-flash` không còn tồn tại** (API trả 404 thẳng).
   Ngay cả `gemini-2.5-flash` cũng đã đóng với người dùng mới. Đổi sang
   **`gemini-3.6-flash`** — model Google tự gợi ý trong thông báo lỗi 404. Nếu
   sau này model này cũng ngừng, gọi
   `GET https://generativelanguage.googleapis.com/v1beta/models?key=<khoá>`
   để xem danh sách còn dùng được.
2. **Dòng model mới mặc định "suy nghĩ" (thinking) rất lâu trước khi trả
   JSON** — đo thật 17.5 giây khi gọi thẳng, 24.5 giây khi tính cả vòng qua
   Vercel. Hậu quả: báo cáo điều hành (mục 5g, phần AI) **âm thầm rơi về bản
   viết bằng luật cứng** dù khoá Gemini hoàn toàn hợp lệ, vì chạm đúng ngưỡng
   chờ 25 giây đặt trong `generateJson`. Không có log lỗi rõ ràng — `engineError`
   trả về chỉ là câu bọc ngoài chung chung, phải tự dựng lại đúng request thật
   rồi đo bằng tay mới ra nguyên nhân. Đã vá 2 lớp trong `lib/ai/provider.ts`
   và 3 route AI:
   - `generationConfig.thinkingConfig: { thinkingLevel: "low" }` — hạ mức
     nghĩ, còn ~6 giây gọi thẳng, JSON vẫn đúng schema, lại rẻ hơn (bớt hẳn
     `thoughtsTokenCount`).
   - Nới `timeoutMs` từ 20-25s lên 45s ở cả 3 nơi gọi Gemini (task-parser,
     kpi-advisor, executive-advisor), thêm `export const maxDuration = 60;`
     cho 3 route API tương ứng — phòng khi Vercel có ngày mạng chậm hơn mức
     đã đo.
   - Xác nhận lại bằng cách gọi thật `POST /api/ai/executive-briefing` trên
     production sau khi vá: `engine: "GEMINI"`, không còn rơi về luật cứng.

**Ghi chú lịch sử — đổi bộ KPI Phòng Sale (10/09/2026):** theo tài liệu
`GANI_FOODY_Tai_lieu_truyen_thong_KPI_Doi_Sales.docx`, thay bộ 4 chỉ tiêu demo
cũ (`SALES_REV/NEW/DEBT/VISIT`) bằng 5 chỉ tiêu mới cộng đúng 100%:
**GP 40% · Doanh thu thuần 25% · Collection Rate 15% · Khách hàng mới 10% ·
SKU chiến lược 10%**. `SALES_DEBT`/`SALES_VISIT` đã ngưng dùng (giữ lịch sử,
không gán cho kỳ mới).

Thêm cơ chế **Gatekeeper**: `SALES_RETURN` (tỷ lệ trả hàng/khiếu nại) có
`defaultWeight = 0` — không cộng điểm dương — nhưng vượt **2%** thì **trừ
thẳng 5 điểm** vào tổng %KPI, đi ngoài công thức trọng số × mức đạt bình
thường. Xử lý ở đúng một chỗ được phép ghi điểm: `recalcResult()` trong
`lib/services/kpi-service.ts` (xem `SALES_RETURN_RATE_GATEKEEPER` ở
`lib/constants.ts`).

**Cố ý CHƯA làm** 2 cơ chế còn lại trong tài liệu — đã hỏi và được xác nhận
thu hẹp phạm vi:
- Khoá thưởng "khách hàng mới" theo tái mua trong 30 ngày.
- Khoá/giảm hệ số Commission khi Gross Margin < 18%.

Lý do: hệ thống hiện **chưa có bộ tính thưởng/hoa hồng ra VNĐ cho khối văn
phòng** (bên xưởng sản xuất đã có `BONUS_TIERS`, khối văn phòng thì chưa) —
hai cơ chế này cần một bộ tính tiền mới, lớn hơn nhiều so với việc đổi trọng
số. Anh vẫn tính tay/Excel như hiện tại cho tới khi quyết làm tiếp.

Áp dụng ngay cho **kỳ KPI mở tiếp theo** — kỳ đang mở hiện tại đã gán dòng
theo bộ cũ, không bị đổi ngược.

**Ghi chú lịch sử — thêm Tầng Team cho Sales Manager (10/09/2026):** làm nốt
phần còn thiếu ở trên. 5 chỉ tiêu: Tổng GP team 40% · Tổng Doanh thu team
20% · Tỷ lệ nợ quá hạn team 20% · Tỷ lệ Sales đạt Target (Min 70%) 10% ·
Doanh số SKU chiến lược team 10%.

Việc này lộ ra một chỗ kiến trúc trước giờ chưa cần tới: hệ thống gán **toàn
bộ** chỉ tiêu đang bật của một phòng ban cho **mọi người** trong phòng đó,
không phân biệt Trưởng phòng hay Nhân viên (`autoAssignTargets()` trong
`app/api/kpi/periods/route.ts`) — đúng cho mọi phòng ban khác vì trước giờ
chưa phòng nào cần tách. Đã thêm cột `KpiDefinition.appliesToRole` (`NULL` =
áp dụng cho cả phòng như cũ, `"MANAGER"`/`"EMPLOYEE"` = chỉ áp dụng cho đúng
vai trò đó) và lọc thêm điều kiện này khi mở kỳ mới. Sáu chỉ tiêu tầng cá
nhân của Sales đã gắn `EMPLOYEE`, năm chỉ tiêu Team gắn `MANAGER` — Trưởng
phòng Sales từ kỳ tới sẽ chỉ thấy 5 chỉ tiêu Team, không lẫn với chỉ tiêu cá
nhân của nhân viên.

**Ghi chú lịch sử — thêm tính năng Nghỉ phép (14/09/2026):** model
`LeaveRequest` mới, trang `/leave-requests` + API `/api/leave-requests`. Luật
báo trước 24h **không chặn cứng** khi gửi trễ hơn — chỉ gắn `isUrgent` (nhãn
đỏ "Khẩn cấp") để người duyệt tự quyết, vì ốm đột xuất là chuyện thật. Ai
duyệt: Trưởng phòng duyệt nhân viên phòng mình; Trưởng phòng/Admin xin nghỉ
thì Ban Giám đốc duyệt; CEO tự động duyệt luôn. Cố ý **chưa nối vào công
thức Chuyên cần (Tier 1)** bên Sản Xuất — đơn nghỉ được duyệt chỉ lưu record,
không tự sửa điểm KPI thật, để tránh sai lương thật. Có nút xuất Excel tổng
hợp theo tháng (`/api/leave-requests/export`, dùng `buildLeaveReport()` ở
`lib/excel.ts`).

**✅ Đã vá (10/2026) — lệch múi giờ UTC/Việt Nam:** mọi phép tính và hiển thị
ngày giờ đi qua `lib/vn-time.ts` với giờ Việt Nam cố định (+7), không phụ thuộc
múi giờ của server. Đặt `TZ` trên Vercel KHÔNG có tác dụng (biến dành riêng của
Vercel), còn `experimental.instrumentationHook` từng thêm vào `next.config.ts`
làm hỏng build — mọi bản sửa múi giờ sau commit đó chưa từng lên production.
Dữ liệu cũ sửa bằng `npm run fix:dates` (xem mục 0). Unit test chạy cả
`TZ=UTC` lẫn `TZ=Asia/Ho_Chi_Minh` để không tái phát.
