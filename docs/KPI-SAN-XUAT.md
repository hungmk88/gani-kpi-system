# KPI Bộ phận Sản xuất — cách tính chi tiết

Tài liệu này để **anh soát lại công thức**. Sai chỗ nào thì sửa số trong
`lib/production/constants.ts` — một file duy nhất, không phải đụng vào mã.

---

## 0. Những chỗ em làm khác bản thiết kế, và vì sao

Bốn điểm. Nói trước để anh biết mình đang nghiệm thu cái gì.

### 0.1 Không thay bộ vai trò cũ, mà thêm vai trò xưởng riêng

Bản thiết kế đề xuất thay `Role` thành `WORKER / TEAM_LEADER / SUPERVISOR /
QC_OFFICER / PRODUCTION_DIRECTOR / CEO`. Thay thẳng là gãy ma trận phân quyền,
luật cấm giao việc vượt cấp và luồng duyệt KPI tháng 2-4-5 — 91 phép thử của
Phase 1–3 sẽ đổ hết.

Em giữ 4 vai trò tổ chức cũ (`EMPLOYEE / MANAGER / CEO / ADMIN`) và thêm trường
`productionRole` riêng. Lý do không chỉ là để khỏi gãy: **hai thứ đó vốn khác
nhau**. Quản đốc là `MANAGER` toàn công ty *và* `SUPERVISOR` trong xưởng. Nhân
viên KCS chỉ là `EMPLOYEE` nhưng nắm quyền xác nhận phẩm chất mà quản đốc không
có. Gộp vào một trường là mất một trong hai.

### 0.2 Ban Giám đốc đặt chỉ tiêu sau khi đã thấy sản lượng — đã bịt

Bản thiết kế để bước 3 là Ban Giám đốc gõ `targetOutputKg` **sau** khi đã nhìn
thấy số thực tế. Ai đặt đích sau khi bắn thì luôn trúng — đây đúng là rủi ro
"Thao túng KPI" mà chính tài liệu Phase 0 cảnh báo.

Cách bịt: mỗi SKU có **chuẩn đặt trước** (`targetOutputKg` trong danh mục SKU).
Lúc khoá số, ô chỉ tiêu điền sẵn chuẩn đó. Đặt khác chuẩn thì **bắt buộc ghi lý
do**, và cả chuẩn cũ lẫn số mới lẫn lý do đều vào nhật ký không xoá được.

### 0.3 Nguyên liệu cấp vào chuyển sang bước 1

`rawMaterialInputKg` là **sự thật từ kho**, biết được ngay đầu ca — không phải
quyết định của Ban Giám đốc. Để nó ở bước 3 nghĩa là con số đó được điền sau khi
đã biết kết quả. Em chuyển sang bước 1 (sản xuất khai theo phiếu kho). Ban Giám
đốc vẫn đính chính được, nhưng phải ghi lý do.

### 0.4 Hai thứ bản thiết kế thiếu, không có thì engine không chạy

**Thiếu bảng ai làm ca đó.** `DailyKpiResult` có `userId` nhưng
`ProductionShiftLog` không có danh sách người — engine không biết chấm cho ai.
Em thêm `ProductionShiftParticipant`.

**Thiếu hẳn công thức Tier 1 và Tier 2.** Bản thiết kế chỉ có trọng số 60/40 và
tên hai tầng, không nói mỗi tầng gồm gì. Toàn bộ mục 3 và 4 dưới đây là em dựng
theo dữ liệu xưởng thực sự ghi được — **đây là phần anh cần soát kỹ nhất.**

---

## 1. Luồng 3 bước

```
  BƯỚC 1 — SẢN XUẤT          BƯỚC 2 — KCS/KCS           BƯỚC 3 — BAN GIÁM ĐỐC
  Sản lượng thô              Đạt QC / làm lại / phế     Chỉ tiêu + khoá số
  Giờ công từng người        Vi phạm HACCP              (chuẩn SKU điền sẵn)
  NVL kho cấp                Lỗi theo từng công đoạn
      DRAFT          →           QC_APPROVED        →         LOCKED
                                                                  │
                                                                  ▼
                                                    Chấm điểm + quét chống
                                                    chạy chỉ tiêu
```

**Ba luật cứng:**

1. Người khai sản lượng **không được tự xác nhận phẩm chất của chính mình**. KCS
   khác phải vào duyệt. (Ban Giám đốc là ngoại lệ duy nhất.)
2. **Chấm điểm chỉ chạy ở bước 3.** Trước đó số còn sửa được, chấm là vô nghĩa.
3. Ca đã khoá thì **đóng băng**. Mở lại được nhưng phải ghi lý do, và toàn bộ
   điểm đã chấm bị xoá để chấm lại từ đầu.

**Ai làm được gì:**

| Việc | Ai |
| --- | --- |
| Khai ca (bước 1) | Công nhân, tổ trưởng, quản đốc, GĐ Sản xuất |
| Xác nhận phẩm chất (bước 2) | Chỉ **KCS** — và không phải người đã khai ca đó |
| Khoá số (bước 3) | Chỉ **Ban Giám đốc** |
| Xem tổn thất quy ra tiền | Chỉ **Ban Giám đốc** và **Giám đốc Sản xuất** |
| Giải trình cảnh báo | Tổ trưởng, quản đốc, GĐ Sản xuất |
| Quyết giải trình | Chỉ **Ban Giám đốc** |
| Quản lý danh mục SKU | Ban Giám đốc, GĐ Sản xuất, quản trị |

---

## 2. Số liệu hệ thống tự tính

Mọi phép chia đều có chặn mẫu số 0 — không bao giờ ra `NaN` hay `Infinity` như
mã mẫu trong bản thiết kế.

| Chỉ số | Công thức |
| --- | --- |
| Định mức NVL của ca | `chỉ tiêu × (1 + % hao hụt định mức của SKU)` |
| Đạt chỉ tiêu | `thành phẩm đạt / chỉ tiêu × 100` |
| Tỷ lệ thu hồi | `thành phẩm đạt / NVL cấp vào × 100` |
| Hiệu suất định mức NVL | `định mức / NVL thực cấp × 100` — trên 100 là tiết kiệm |
| Tỷ lệ hỏng | `(phế + làm lại × 0,3) / sản lượng thô × 100` |
| Năng suất ca | `thành phẩm đạt / tổng giờ công` |
| Lệch cân đối | `\|sản lượng thô − (đạt + làm lại + phế)\|` |
| Tổn thất quy tiền | `(phế + làm lại × 0,3 + NVL vượt định mức) × đơn giá` |

Hệ số **0,3** cho hàng làm lại lấy đúng bản thiết kế: làm lại vẫn cứu được hàng,
chỉ mất công và điện, nên không tính đủ như phế phẩm.

---

## 3. TẦNG 2 — kết quả chung của cả ca (trọng số 40%)

Mọi người trong ca nhận **cùng một điểm này**. Đây là phần "cùng thuyền".

| Thành phần | Trọng số | Cách chấm |
| --- | --- | --- |
| Đạt chỉ tiêu sản lượng | 35% | Lấy thẳng % đạt được, chặn trần 150 |
| Giữ định mức nguyên liệu | 25% | Lấy hiệu suất định mức, chặn trần 150 |
| Phế phẩm và hàng làm lại | 25% | `100 − (tỷ lệ hỏng / 10%) × 100`, hỏng 10% là 0 điểm |
| An toàn thực phẩm | 15% | `100 − số vi phạm × 50`, 2 vi phạm là 0 điểm |

**Điểm tầng 2 = tổng (điểm thành phần × trọng số) / 100**

Số chỉnh được: `TIER2_COMPONENTS`, `SHIFT_QUALITY_ZERO_AT_PERCENT`,
`SAFETY_PENALTY_PER_VIOLATION`.

---

## 4. TẦNG 1 — phần của riêng từng người (trọng số 60%)

| Thành phần | Trọng số | Cách chấm |
| --- | --- | --- |
| Chất lượng công đoạn | 50% | `100 − (tỷ lệ lỗi công đoạn / 5%) × 100` |
| Chuyên cần | 25% | `giờ làm thực tế / giờ đăng ký × 100`, trần 100 |
| Kỷ luật & an toàn cá nhân | 25% | `100 − số vi phạm × 34`, 3 vi phạm là 0 điểm |

**Tỷ lệ lỗi công đoạn** = `lỗi của người đó / khối lượng quy cho người đó`, trong
đó khối lượng quy cho một người = `thành phẩm đạt của ca × (giờ công của người đó
/ tổng giờ công ca)`.

### Vì sao KHÔNG có "năng suất cá nhân" ở tầng này

Đây là quyết định quan trọng nhất của tầng 1, nói rõ để anh cân nhắc.

Xưởng chỉ cân được **sản lượng của cả ca**, không cân được của từng người. Lấy
sản lượng ca chia cho giờ công thì mọi người trong ca ra **đúng một con số như
nhau** — chấm kiểu đó không phân biệt được ai làm tốt ai làm ẩu, mà lại tạo cảm
giác đang chấm cá nhân. Tệ hơn nữa: nó thưởng cho người làm ẩu mà nhanh.

Ba thành phần trên là những thứ xưởng **thực sự ghi riêng được cho từng người**:
KCS chỉ ra lỗi thuộc công đoạn nào, chấm công có sẵn, vi phạm nội quy có sổ.

> Muốn chấm năng suất cá nhân thật thì phải cân bán thành phẩm ở từng công đoạn —
> tức là thêm một khâu cân giữa chuyền. Xưởng làm được thì báo em, em thêm vào.

**Điểm cuối = tầng 1 × 0,6 + tầng 2 × 0,4** — chặn trần 150.

Nhân viên bấm vào tên mình là mở ra xem đủ từng thành phần, điểm bao nhiêu, vì
sao — không phải tin một con số từ trên trời rơi xuống.

---

## 5. Ba luật chống chạy chỉ tiêu

Lấy nguyên từ bản thiết kế. Nguyên tắc xử lý: phát hiện thì **khoá thưởng tạm
thời**, **không trừ điểm và không kết tội**. Máy đọc số có thể sai — lô thịt đông
rã nước nhiều hơn bình thường cũng ra đúng dấu hiệu như người cố tình ép máy.

| Luật | Điều kiện | Mức |
| --- | --- | --- |
| Chạy sản lượng, phá nguyên liệu | Đạt chỉ tiêu **và** NVL vượt định mức > 8% | Nghiêm trọng |
| Nghi giấu phế sang làm lại | Phế = 0 **và** làm lại > 4% thành phẩm đạt | Cảnh báo |
| Lệch cân đối khối lượng | Lệch > 5 kg **hoặc** > 2% sản lượng thô | Nghiêm trọng |

> Luật 3: bản thiết kế chỉ có ngưỡng tuyệt đối 5 kg. Em thêm ngưỡng tương đối 2%
> vì 5 kg trên mẻ 500 kg là 1% (bình thường), còn 4 kg trên mẻ 50 kg là 8% (rất
> bất thường) mà ngưỡng tuyệt đối lại bỏ lọt.

**Đường xử lý:** phát hiện → khoá thưởng cả ca → quản đốc giải trình (≥20 ký tự)
→ Ban Giám đốc quyết (≥10 ký tự ý kiến).

Thưởng **chỉ mở khi ca đó hết sạch cảnh báo treo và không cái nào bị từ chối**.
Duyệt một cái mà còn hai cái đang chờ thì vẫn khoá — hệ thống nói rõ điều đó trên
màn hình.

---

## 6. Bậc thang thưởng

| Điểm cuối | Hệ số |
| --- | --- |
| ≥ 120 | 1,5 |
| 110–119 | 1,2 |
| 100–109 | 1,0 |
| 90–99 | 0,7 |
| < 90 | 0 |

Tiền thưởng nền một ca đang để **0 đồng** (`BASE_BONUS_PER_SHIFT_VND`) — tức là
phần thưởng đang tắt, hệ thống chỉ chấm điểm. Anh điền số vào đó là thưởng chạy.

---

## 7. Nối sang KPI tháng

Đây là chỗ hai hệ thống gặp nhau. Không có nó thì xưởng chấm điểm ca mỗi ngày còn
KPI tháng vẫn phải gõ tay — hai bộ số sống riêng, cuối tháng lệch nhau không ai
giải thích được.

Mỗi lượt chạy nền, hệ thống gộp các ca **đã khoá** trong tháng, quy về từng người
rồi đẩy vào cột *Số hệ thống* của KPI tháng:

| Chỉ tiêu KPI tháng | Lấy từ ca sản xuất |
| --- | --- |
| `PROD_OUT` — Sản lượng thành phẩm | Tổng khối lượng quy cho người đó |
| `PROD_DEFECT` — Tỷ lệ hàng lỗi | Lỗi công đoạn / khối lượng quy cho người đó |
| `PROD_ONTIME` — Tỷ lệ đúng hạn | % số ca người đó tham gia mà ca đạt chỉ tiêu |
| `PROD_SAFE` — Sự cố an toàn | Tổng vi phạm cá nhân |

Số này đi qua **đúng bộ đối soát của Phase 3**. Nghĩa là nếu công nhân tự khai
lệch quá 5% so với số máy tính ra từ nhật ký ca, hệ thống treo lại chờ người
quyết — không tự chọn bên nào.

Chỉ gộp ca **đã khoá**. Ca còn DRAFT hay chờ KCS thì số chưa chắc.

Hệ thống **không tự tạo dòng KPI mới** cho ai. Quản lý chưa gán chỉ tiêu đó cho
người nào thì đừng gán thay họ.

> Muốn điểm ca hằng ngày tính thẳng vào KPI tháng thì thêm một chỉ tiêu
> `PROD_SHIFT_SCORE` trong Quản trị → Danh mục KPI, rồi chia lại trọng số cho
> tổng vẫn bằng 100%. Em chưa tự thêm vì nó sẽ phá tổng trọng số 100% hiện có của
> phòng Sản xuất.

---

## 8. Số nền lấy từ Vault

| Số | Nguồn |
| --- | --- |
| Trần 500 kg/ca | Nút thắt máy hút chân không 50 kg/giờ × 10 giờ/ca — `wiki/thuc-the/xuong-hcm01.md` |
| 1 ca = 10 giờ, 6 ngày/tuần | Anh Hùng xác nhận 03/09/2026 |
| Trần ~13 tấn/tháng | Suy ra từ hai số trên |

**Chưa có trong Vault:** định mức nguyên liệu thật của xưởng. Ba SKU mẫu đang để
hao hụt 6–8% là **số em đặt tạm**, không phải số thật của GANI. Đây đúng là câu
hỏi lớn số 3 còn treo ở `wiki/index.md`.

Chạy hệ thống 1–2 tháng là **tự có định mức thật**: mỗi ca đều ghi NVL cấp vào và
thành phẩm ra, gộp lại là ra tỷ lệ thu hồi thực tế của từng mã.

---

## 9. Kiểm thử

```bash
npm run test:production
```

**43 phép thử**: luồng 3 bước không nhảy cóc, không tự duyệt phần mình khai, bắt
buộc lý do khi đặt chỉ tiêu khác chuẩn, công thức 2 tầng đúng đến từng số lẻ, đủ
3 luật chống chạy chỉ tiêu, khoá và mở thưởng đúng điều kiện, công nhân không xem
được tiền, và cầu nối sang KPI tháng chạy được.

Hai phép thử đáng chú ý nhất:

- *"Điểm tầng 2 giống nhau cho mọi người trong cùng ca"* — xác nhận phần "cùng
  thuyền" hoạt động
- *"Điểm tầng 1 KHÁC nhau — người lỗi nhiều và có vi phạm phải thấp hơn"* — xác
  nhận phần cá nhân thực sự phân biệt được người, không phải trang trí
