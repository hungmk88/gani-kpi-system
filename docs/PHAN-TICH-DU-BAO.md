# Phân tích & Dự báo — công thức và ngưỡng

Tài liệu này để Ban Giám đốc soát lại **cách máy tính ra từng con số** trong menu
*Phân tích & Dự báo*. Mọi hằng số nhắc ở đây nằm trong một file duy nhất:
`lib/analytics/constants.ts` — sửa ở đó là toàn hệ thống đổi theo, không phải đi
tìm trong mã.

Phần tính toán thuần nằm ở `lib/analytics/engine.ts` (không chạm database), phần
đọc ghi dữ liệu nằm ở `lib/services/analytics-service.ts`.

---

## 0. Luật nền: có bao nhiêu dữ liệu thì nói bấy nhiêu

Đây là luật quan trọng nhất của cả phần này, và là chỗ bản triển khai **cố ý làm
khác tài liệu thiết kế gốc**.

Phần mềm sai không nguy hiểm bằng phần mềm sai *một cách trông rất thuyết phục*.
Một biểu đồ dự báo dựng trên 2 mẫu dữ liệu vẫn ra số, vẫn vẽ được đường xu hướng
đẹp — và người xem nhìn nó rồi ra quyết định thật.

Nên mọi kết quả trả về đều kèm hai thứ:

| Trường | Nghĩa |
| --- | --- |
| `sampleSize` | Dựa trên bao nhiêu mẫu dữ liệu |
| `confidence` | `HIGH` Đủ căn cứ · `MEDIUM` Tạm đủ · `LOW` Mỏng, tham khảo thôi · `NONE` Chưa đủ dữ liệu |

Ở mức `NONE`, hệ thống **không kết luận** — màn hình ghi thẳng là chưa đủ dữ liệu
và cần thêm bao nhiêu nữa.

---

## 1. Dự báo nguy cơ vỡ kế hoạch

### 1.1 Nhịp làm việc của từng người

Lấy các việc người đó **đã đóng**, mỗi việc tính tỷ lệ:

```
nhịp một việc = số ngày kế hoạch / số ngày làm thật
```

Trên 1 là làm nhanh hơn kế hoạch, dưới 1 là chậm hơn. Lấy **trung vị** của các tỷ
lệ đó (trung vị chứ không phải trung bình — một việc kéo dài bất thường không
được phép kéo lệch cả bức tranh), rồi kẹp vào khoảng **0,5 – 1,5**.

Ngưỡng dữ liệu:

| Số việc đã đóng | Mức tin |
| --- | --- |
| dưới 5 | `NONE` — dùng nhịp trung tính 1,0 và **ghi rõ là chưa tính được thói quen làm việc** |
| 5 – 11 | `LOW` |
| 12 – 24 | `MEDIUM` |
| từ 25 | `HIGH` |

### 1.2 Khả năng kịp hạn

Bắt đầu từ 100 điểm, trừ dần theo từng dấu hiệu:

| Dấu hiệu | Trừ |
| --- | --- |
| Chậm hơn tiến độ đáng lẽ phải có quá 20% | 35 |
| Đang bị chặn, chưa ai gỡ | 30 |
| Điểm rủi ro vận hành đã ≥ 60/100 | 25 |
| Chưa giao cho ai | 25 |
| Đang chờ việc khác mà việc đó đã trễ | 20 |
| Người phụ trách đang ôm hơn 5 việc cùng lúc | 15 |

Trong đó *tiến độ đáng lẽ phải có* = (phần thời gian đã trôi) × (nhịp làm việc của
người phụ trách). Đây là chỗ nhịp làm việc phát huy tác dụng: **cùng một mức tiến
độ, người hay trễ vẫn bị dự báo xấu hơn người hay đúng hạn.**

Tiến độ thực tế **ưu tiên số người kéo tay**; chỉ khi chưa ai kéo mới suy ra từ
trạng thái. (Bản thiết kế gốc luôn suy từ trạng thái — làm vậy là vứt đi dữ liệu
tốt hơn.)

Điểm cuối kẹp trong 5–99, rồi xếp nhóm:

- dưới 40 → **Nhiều khả năng vỡ**
- 40 – 69 → **Có nguy cơ**
- từ 70 → **Đang bám kế hoạch**

Chỉ dự báo cho việc có hạn trong vòng **30 ngày** — xa hơn thì đoán vô nghĩa.

### 1.3 Hệ thống tự chấm lại chính nó

Mỗi lượt cron lưu một dòng vào bảng `prediction_logs`. Khi việc đóng lại, cron so
dự báo cũ với kết quả thật:

| | Thực tế trễ | Thực tế kịp |
| --- | --- | --- |
| **Dự báo trễ** | Đúng | Báo động giả |
| **Dự báo kịp** | **Sai loại nguy hiểm** | Đúng |

Ô góc dưới bên trái là loại sai đáng sợ nhất: hệ thống bảo ổn, rồi việc trễ thật —
người xem yên tâm nên không can thiệp. Màn hình Phân tích tách riêng con số này.
**Chưa có việc nào đóng sau khi dự báo thì hệ thống trả về "chưa đo được", không
bịa ra tỷ lệ chính xác.**

---

## 2. Cân bằng tải nhân sự

```
mức tải % = (tổng giờ ước tính của việc đang mở) / 160 giờ × 100
```

Giờ ước tính lấy từ ô `estimatedHours` của công việc. Việc chưa điền thì suy theo
mức ưu tiên: Thấp 4h · Trung bình 12h · Cao 20h · Khẩn cấp 28h — và bản ghi đó bị
hạ mức tin cậy, có ghi rõ trên màn hình. (Bản thiết kế gốc áp cứng 12 giờ cho mọi
việc, không phân biệt việc khẩn với việc lặt vặt.)

Xếp nhóm: trên **115%** là *Quá tải*, dưới **60%** là *Còn dư sức*, giữa là *Vừa sức*.

Giờ thuộc việc **đã quá hạn** được tách riêng — 120% mà toàn việc còn hạn khác hẳn
120% mà một nửa đã trễ.

### Gợi ý san việc

Hai luật cứng:

1. **Chỉ trong cùng phòng ban.** Đúng theo quyết định cấm giao việc vượt cấp
   (`ALLOW_CROSS_DEPT_ASSIGN = false`). Bộ cân bằng tải không có đặc quyền phá luật.
2. **Chỉ chuyển vừa đủ.**
   ```
   số giờ đề nghị = min( phần vượt quá 100% của người đang gánh nặng,
                         chỗ trống tới 100% của người nhận )
   ```
   Không phải chia đôi khoảng chênh — chia đôi thì một người 118% gặp một người
   0% sẽ bị đề nghị chuyển gần như toàn bộ công việc sang người chưa quen việc đó.

Đây là **gợi ý**, không tự chuyển. Người quyết vẫn là trưởng phòng.

---

## 3. Phát hiện bất thường KPI

So số nhân viên tự khai kỳ này với **lịch sử của chính người đó trên chính chỉ
tiêu đó**. Hai thước chạy song song:

```
z-score    = (số kỳ này − trung bình lịch sử) / độ lệch chuẩn      ngưỡng 2,5
thước bền  = 0,6745 × (số kỳ này − trung vị) / MAD                 ngưỡng 3,5
```

MAD (trung vị của khoảng cách tới trung vị) không bị một tháng đột biến trong quá
khứ kéo lệch như độ lệch chuẩn. Chạy cả hai rồi đối chiếu: hai thước cùng kêu thì
gần như chắc chắn, một thước kêu thì đáng để mắt.

Thêm một luật đơn giản: cao gấp **2,5 lần trung vị** cũng tính là bất thường, kể
cả khi độ lệch chưa vượt ngưỡng.

### Ngưỡng số kỳ lịch sử

| Số kỳ có sẵn | Kết luận cao nhất được phép |
| --- | --- |
| dưới 4 | **Không kết luận gì cả** |
| 4 – 5 | Tối đa mức *Cảnh báo* |
| từ 6 | Được phép mức *Nghiêm trọng* |

Bản thiết kế gốc chỉ chặn ở dưới 3 kỳ. Ba điểm là quá ít cho z-score: một ngoại lệ
duy nhất đủ làm phồng độ lệch chuẩn và che mất bất thường thật.

### Cảnh báo không phải là kết tội

Bất thường **không tự trừ điểm, không khoá gì cả**. Nó chỉ nói: số kỳ này lệch hẳn
nếp cũ của chính người đó. Lệch có thể vì gian, mà cũng có thể vì tháng đó chốt
được đơn lớn thật.

Luồng xử lý: **Chờ giải trình** → chính người bị nêu tên giải trình (tối thiểu 20
ký tự) → trưởng phòng hoặc Ban Giám đốc **chấp nhận** hoặc **bỏ qua** (kèm kết
luận tối thiểu 10 ký tự). Không ai giải trình hộ số liệu của người khác. Mọi bước
vào nhật ký. Lượt quét sau không ghi đè cảnh báo đã xử lý.

---

## 4. Điểm sức khoẻ vận hành

Điểm 0–100 **do hệ thống tính bằng công thức cố định**, không phải AI đoán:

| Thành phần | Trọng số | Đo cái gì |
| --- | --- | --- |
| Việc đúng hạn | 30 | Tỷ lệ việc đang mở mà chưa trễ |
| Rủi ro thấp | 20 | Không có việc ở mức báo động đỏ |
| Tải cân bằng | 20 | Không ai quá tải |
| Số liệu sạch | 15 | KPI không lệch giữa các nguồn |
| Không bất thường | 15 | Không có cảnh báo KPI đang treo |

Xếp loại: từ 85 **Tốt** · từ 70 **Ổn, có chỗ cần siết** · từ 55 **Đang có vấn đề**
· dưới 55 **Cần can thiệp ngay**.

Tài liệu thiết kế gốc để AI tự sinh điểm này. Đó đúng là kiểu "sai một cách thuyết
phục": một con số 0–100 trông như đo đạc nhưng thực ra là máy ước chừng, và hỏi
hai lần ra hai số khác nhau. Ở đây AI **chỉ viết phần diễn giải bằng lời**; nếu
nó trả về một điểm khác thì điểm đó bị bỏ. Không có khoá AI thì hệ thống tự viết
báo cáo bằng luật cứng — vẫn chạy được, chỉ là văn khô hơn.

---

## 5. Khi mới bắt đầu dùng

Ba engine đều đọc quá khứ để đoán tương lai, nên **tháng đầu tiên sẽ thấy nhiều
chỗ ghi "chưa đủ dữ liệu"**. Đó là hành vi đúng, không phải lỗi.

Mốc thời gian thực tế:

- Sau **~5 việc đã đóng mỗi người** → bắt đầu có nhịp làm việc riêng của từng người.
- Sau **4 kỳ KPI** → bộ phát hiện bất thường bắt đầu kết luận được.
- Sau **6 kỳ KPI** → mới được phép gắn mức *Nghiêm trọng*.
- Sau **vài chục việc đóng lại kể từ ngày bật** → mới có con số độ chính xác của
  chính bộ dự báo. Đừng tin bộ dự báo trước khi nhìn con số đó.

Muốn xem thử ngay trước khi có dữ liệu thật: `npm run seed` dựng sẵn 6 kỳ KPI cũ,
54 việc đã đóng và một khai báo đột biến gấp 3,2 lần (`prisma/seed-history.mjs`).
Số sinh theo hạt cố định nên chạy lại bao nhiêu lần cũng ra đúng bộ số đó.
