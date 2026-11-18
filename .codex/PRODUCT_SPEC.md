# VelunaMusic — Đặc tả sản phẩm / Product Specification

Cập nhật / Updated: 18/11/2026 (Asia/Saigon).

Vị trí chính thức / Canonical location: `.codex/PRODUCT_SPEC.md`.

Tài liệu có hai bản đầy đủ: **Tiếng Việt** ở phần đầu và **English** ở phần sau. Hai bản mô tả cùng một sản phẩm; khi sửa yêu cầu phải cập nhật cả hai.

This document contains two complete versions: **Vietnamese** first and **English** second. Both describe the same product; requirement changes must be reflected in both versions.

---

# Tiếng Việt

## 1. Mục tiêu và trạng thái

Một sản phẩm có bản Android và Windows, dành cho cá nhân và nhóm nhỏ trước. Lõi logic dùng Rust; cho phép Kotlin và API native ở phần tích hợp hệ thống. Tham khảo SimpMusic để phát triển thư viện, playback và AutoMix.

Toàn bộ tính năng trong tài liệu thuộc phạm vi bản phát hành đầu tiên. Mã thử nghiệm Android và Windows nằm trên nhánh `codex/dev`. Chỉ phát hành bộ cài và mở nút tải khi đã hoàn tất đặc tả, gồm account, handoff và AI DJ.

Ba ưu tiên: nghe nhạc ổn định, cá nhân hóa sâu, phát nền ít hao điện. Giao diện khi mở app có animation nổi bật; công việc không cần thiết phải nghỉ khi xuống nền.

Các quyết định người dùng đã chọn: một sản phẩm có hai bản Android/Windows; lõi Rust kết hợp native; nguồn YouTube và nhạc local, bổ sung Spotify; phát hành cho cá nhân/nhóm nhỏ trước; ưu tiên Spotify phát trong app; chuyển máy và remote với một máy phát chính. Các chi tiết mang nhãn “đề xuất”, framework UI, nhà cung cấp/model LLM và ngưỡng benchmark chưa được xem là quyết định cuối cùng. Supabase Singapore lưu dữ liệu tài khoản.

## 2. Nguồn nhạc, thư viện và chất lượng

- Hỗ trợ YouTube/YouTube Music, nhạc local và tích hợp Spotify. Spotify phát trong app là yêu cầu ưu tiên cần khảo sát khả thi trước khi cam kết.
- Tìm kiếm chung, nhãn nguồn rõ ràng, thư viện yêu thích, album, nghệ sĩ, playlist và hàng chờ. Playlist đa nguồn phụ thuộc khả năng và điều kiện của từng dịch vụ; chưa coi Spotify đã được phép tham gia player đa nguồn.
- Phân biệt bản gốc, live, remix và các phiên bản khác. Khi đối chiếu bài giữa hai nguồn, hiển thị kết quả để sửa; ghi nhớ lựa chọn theo từng phiên bản. Không tự đổi nguồn mà che giấu với người nghe.
- Playlist thông minh theo dữ liệu được phép sử dụng: thể loại, thời lượng, lần nghe gần nhất và năng lượng khi có phân tích phù hợp. Hỗ trợ phiên nghe có diễn biến năng lượng theo thời gian.
- Có lựa chọn “Cao nhất khả dụng”: chọn chất lượng mà nguồn thực sự cấp cho tài khoản và thiết bị. Hiển thị codec, bitrate hoặc thông số lossless khi xác định được; hiển thị chưa xác định nếu thiếu dữ liệu.
- Mong muốn gốc của người dùng: tài khoản không Premium vẫn nghe ở chất lượng tốt nhất có thể truy cập. Phải giữ mục tiêu này trong thiết kế, đồng thời mô tả trung thực giới hạn quyền của nguồn; chưa xác nhận có thể đạt chất lượng Premium khi không có Premium.
- Account của VelunaMusic không cấp thêm quyền Premium của dịch vụ. Không hứa Spotify Premium/lossless hoặc luồng YouTube Music Premium cho tài khoản không có quyền tương ứng. Tăng bitrate hoặc đổi định dạng sau giải mã không tạo lại chi tiết đã mất.
- Cache, nghe offline và tải về chỉ áp dụng với nội dung/nguồn cho phép. Có giới hạn dung lượng, thống kê theo loại dữ liệu và thao tác dọn riêng nhạc, ảnh nền, cache, dữ liệu DJ.
- Sao lưu và nhập lại playlist, thư viện, theme, thiết lập; thông báo rõ phần media nào có trong bản sao lưu. Không kèm API key hoặc token đăng nhập trong bản xuất thông thường.

## 3. Playback và tiện ích

- Phát, pause, tua, shuffle, repeat, hàng chờ, lyrics và hẹn giờ ngủ. Có xử lý cuộc gọi, audio focus, tháo tai nghe, mất mạng và URL phát hết hạn.
- Crossfade chỉnh thời gian, AutoMix, lựa chọn giữ nguyên chuyển tiếp trong album. Phân biệt chuyển bằng cách chồng hai bài với phát liền bài không chồng âm thanh; kiểm chứng khả năng của từng backend.
- Tham chiếu bộ điều khiển đã thấy trong upstream: Auto và các mức 1, 2, 3, 5, 8, 10, 12, 15, 20, 30 giây; DJ mode và bỏ crossfade trong album. Khảo sát kế thừa các mức này; Cast/nguồn không hỗ trợ phải hiển thị trạng thái thay vì bật nút không có tác dụng.
- Cân bằng loudness giữa bài khi có dữ liệu đo, kiểm soát headroom và clipping khi mix. Không cam kết cân bằng chính xác nếu chưa phân tích được bài.
- Profile âm thanh theo đầu ra: EQ, mức âm lượng và thiết lập liên quan giữ riêng cho từng thiết bị; có thể chọn profile thủ công khi hệ thống không nhận diện ổn định.
- Khôi phục hàng chờ, bài, vị trí, phong cách và kế hoạch DJ sau khi mở lại. Mặc định đề xuất: phục hồi ở trạng thái pause, có nút tiếp tục.
- Windows: tray, mini player, phím media, phím tắt tùy chỉnh và chọn đầu ra khi backend hỗ trợ.
- Android: media notification, màn hình khóa, nút tai nghe, widget, cử chỉ tùy chỉnh; Android Auto được giữ trong roadmap.
- Chữ lớn, độ tương phản, vùng bấm đủ rộng, điều hướng bằng bàn phím và giảm chuyển động.

## 4. Account, liên kết dịch vụ và đồng bộ

- Một account VelunaMusic quản lý thiết bị, playlist của app, yêu thích, lịch sử, theme và thông tin phiên nghe. Nhạc local vẫn dùng được khi chưa đăng nhập.
- Liên kết dịch vụ qua luồng được dịch vụ hỗ trợ; tách danh tính VelunaMusic khỏi danh tính và quyền phát của từng nguồn. Không thu mật khẩu dịch vụ qua form của app.
- Mỗi thiết bị nhận quyền truy cập phù hợp; không sao chép token hoặc cookie thô giữa máy như cách đồng bộ thư viện. Có ngắt liên kết, thu hồi thiết bị và xóa dữ liệu liên quan theo yêu cầu dịch vụ.
- Đồng bộ thư viện, theme, hàng chờ và mốc phát; âm lượng, đầu ra, quyền truy cập file và bố cục theo thiết bị giữ riêng. Có chọn phần theme nào đồng bộ.
- Một máy phát chính trong phiên chuyển tiếp. Máy đích kiểm tra nguồn/file, quyền phát và khả năng seek; máy cũ chỉ dừng khi máy đích xác nhận sẵn sàng. Nếu chuyển thất bại, giữ phiên cũ và báo lý do.
- Remote hai chiều: play/pause, next/previous, seek, hàng chờ và âm lượng máy đích. Luôn chỉ rõ máy đang phát; phản hồi pending, thành công hoặc lỗi.
- Lưu thao tác offline rồi đồng bộ lại. Dùng định danh thao tác và phiên bản để tránh thêm trùng hoặc lệnh cũ ghi đè phiên mới; thay đổi đồng thời không giải quyết được phải có giao diện chọn.
- Đồng bộ theo sự kiện và mốc thời gian; không gửi từng frame hoặc polling dày để cập nhật thanh tiến độ. Khi Android ngủ sâu hoặc app bị hệ thống dừng, hiển thị trạng thái thực và hỗ trợ kết nối lại.
- Đồng bộ dữ liệu account qua mạng và truyền media trực tiếp qua LAN là hai luồng riêng. Thiết bị đã ghép đôi có thể dùng LAN khi internet mất, nếu quyền phát/file vẫn hợp lệ.

## 5. Kéo thả bài từ điện thoại sang PC cùng mạng

### Trải nghiệm

- PC và điện thoại mở VelunaMusic, đã ghép đôi và kết nối được qua LAN. PC dùng Ethernet vẫn có thể tham gia nếu cùng mạng truy cập được với Wi-Fi của điện thoại.
- Trên điện thoại, giữ một hoặc nhiều bài; các ô PC khả dụng xuất hiện. Kéo thả vào ô PC để gửi, có lựa chọn “Phát ngay”, “Phát tiếp theo”, “Thêm cuối hàng chờ” và “Chỉ chuyển file” khi phù hợp.
- Mặc định đề xuất: thả thông thường thêm cuối hàng chờ để không ngắt bài đang phát. Các vùng thả riêng cho phép chủ động chọn hành động khác.
- Đây là thao tác kéo thả trong giao diện điện thoại tới đích PC; không hứa một con trỏ hay ngón tay có thể di chuyển liên tục giữa hai màn hình vật lý.
- Bài online: gửi định danh nguồn và yêu cầu hàng chờ. PC tự phân giải/phát bằng quyền truy cập của PC; không gửi file DRM hoặc chia sẻ quyền Premium.
- Bài local: chuyển file gốc đã được người dùng chọn, giữ metadata và kiểm tra tính toàn vẹn. Tệp chưa nhận hoàn tất không được coi là đã sẵn sàng phát trong bản đầu.
- Hiển thị tiến độ, hủy, retry và trạng thái nhận ở hai máy. Có chống nhận trùng theo định danh nội dung; không ghi đè file hiện có chỉ vì trùng tên. Đề xuất có tiếp tục truyền sau gián đoạn.

### Kết nối và tin cậy

- Dò dịch vụ bằng mDNS/DNS-SD hoặc Android NSD khi mở mục thiết bị/kéo thả. Dừng dò chủ động khi rời mục này; phiên phát/truyền đang hoạt động vẫn duy trì kết nối cần thiết.
- Ghép đôi ban đầu bằng QR hoặc mã ngắn có thời hạn và xác nhận ở hai đầu. Sau đó kết nối mã hóa có xác thực danh tính thiết bị, hỗ trợ hủy ghép đôi.
- “Cùng mạng” xác định bằng kết nối thực tế; không dùng chung SSID hoặc sự xuất hiện trong danh sách dò làm bằng chứng tin cậy. LAN không đo được khoảng cách vật lý chính xác.
- Chỉ nhận tự động từ thiết bị đã tin cậy và khi người dùng bật nhận. Có thông báo nhận bài; file chỉ vào thư mục media của app, không thực thi nội dung nhận.
- Khi multicast bị chặn có đường ghép/kết nối trực tiếp bằng QR nếu unicast còn hoạt động. Nếu router cô lập thiết bị, VPN hoặc firewall chặn kết nối, báo nguyên nhân có thể kiểm tra và hướng dẫn thử lại; QR không vượt được việc mạng chặn đường truyền.
- Xin quyền mạng cục bộ và truy cập file theo phiên bản Android/target SDK thực tế; xử lý việc từ chối và thu hồi quyền. Windows xử lý quy tắc firewall trong quy trình cài/chạy app, không vô hiệu hóa firewall.

## 6. AI DJ

- Có trang DJ riêng. Người dùng chọn album/thư mục local hoặc nguồn được phép phân tích, chọn phong cách và nhập API key LLM của mình. Hỗ trợ lựa chọn nhà cung cấp/model; chưa chốt model cụ thể.
- Phân tích âm thanh tại máy để tìm tempo, beat grid, năng lượng, intro/outro và các điểm chuyển khả dụng. Dữ liệu chỉ là ước lượng; hiển thị khi độ tin cậy thấp.
- Engine tạo các phương án chuyển có giới hạn rõ ràng; LLM chọn phương án dựa trên đặc trưng đã đo và mục tiêu phiên nghe. Không suy ra điểm beat chính xác chỉ từ tên bài.
- Chuẩn bị kế hoạch ngay khi biết cặp bài kế tiếp, trước cửa sổ chuyển; cache theo nội dung, phiên bản phân tích, cặp bài, phong cách và model. Chỉ tính lại phần bị ảnh hưởng khi đổi hàng chờ.
- LLM trả cấu trúc để app xác minh: chọn phương án tồn tại, thời điểm hợp lệ, giới hạn tempo/EQ/volume. Engine Rust thực hiện chuyển đúng thời gian tại máy; lệnh đến trễ không sửa transition đang diễn ra.
- API lỗi, hết ngân sách, mất mạng hoặc kế hoạch không hợp lệ: dùng AutoMix cục bộ và tiếp tục phát. Tác vụ LLM không được chặn luồng âm thanh.
- Chế độ nhẹ nhàng, giữ nguyên bài và party; giữ thứ tự album hoặc cho phép xếp thư mục. Mức can thiệp từ chỉnh âm lượng tới tempo/EQ; không mặc định cắt đoạn nhạc nếu chưa có lựa chọn tương ứng.
- Nghe thử đoạn nối, chỉnh tay và đánh giá “hay”, “chồng giọng”, “cắt sớm”. Dùng phản hồi cho lựa chọn sau; không cam kết LLM luôn tốt hơn heuristic.
- API key lưu trong kho bảo mật của từng thiết bị, không log hoặc tự đồng bộ qua account. Cho chọn loại dữ liệu gửi; mặc định đề xuất gửi đặc trưng tối thiểu, không upload cả thư mục âm thanh.
- Trang thiết lập AI có chọn nhà cung cấp, model và thao tác kiểm tra kết nối/key. Chỉ mục AI DJ yêu cầu key cho phần LLM; player và AutoMix cục bộ vẫn dùng được khi chưa nhập key. Tính năng suy luận LLM bổ sung phải được phân biệt với AutoMix sẵn có của SimpMusic.
- Có giới hạn lượt gọi, ngân sách ước tính, lượng sử dụng API thực sự báo về và nút tắt AI. Chi phí chưa xác định không hiển thị như số đo chính xác.
- Cache phân tích một lần; phân tích hàng loạt có thể chạy khi cắm sạc. Tạo benchmark so sánh AutoMix cục bộ với LLM trên nhạc được phép sử dụng.
- Spotify DJ bị giới hạn bởi chính sách về mix/overlap, phân tích nội dung và đưa nội dung vào AI. Không bật các chức năng đó cho Spotify khi chưa có quyền phù hợp; Premium không tự cấp các quyền này.

## 7. Liquid Glass và tùy biến toàn giao diện

- Theme toàn app áp dụng cho sidebar, thanh điều hướng, mini player, Now Playing, thẻ album/playlist, tìm kiếm, menu, popup, nút, slider và các bề mặt do app vẽ.
- Mỗi thành phần kế thừa theme chung hoặc có override riêng. Chỉnh toàn app chỉ cập nhật phần đang kế thừa; có reset từng thành phần hoặc toàn theme.
- Chỉnh độ trong, blur, tint, viền, highlight, bóng, bo góc và chuyển động. Chữ, icon, lyrics có màu, kích thước và độ tương phản độc lập. Người dùng chọn bật kính hay dùng màu đặc cho từng bề mặt.
- Tùy chỉnh font và phong cách chữ cùng kích thước, bố cục theo thiết bị. Màu nhấn và hệ màu theme áp dụng nhất quán toàn app; chỉnh hiển thị không thay đổi metadata hoặc quyền của nguồn nhạc.
- Ảnh nền riêng; crop/vị trí, độ mờ và lớp phủ tối. Theme theo playlist, đổi màu theo bìa nếu người dùng bật; xử lý ảnh một lần và cache bản phù hợp màn hình.
- Chế độ chỉnh trực tiếp: chọn thành phần, xem trước tức thì, undo/redo, reset. Có preset kính trong, kính mờ, kính tối và màu đặc; lưu, xuất/nhập, đồng bộ theme.
- Đổi thứ tự hoặc ẩn mục trang chủ; chọn player tối giản, bìa đĩa hoặc tập trung lyrics. Layout thích ứng Android và Windows.
- Giữ chữ rõ và vùng bấm ổn định trong mọi preset. Giao diện hệ thống như bảng quyền, bàn phím và thông báo chỉ tùy biến trong giới hạn nền tảng.

## 8. Animation nổi bật

Yêu cầu đã chốt: animation giàu chuyển động khi app đang hiển thị, cảm giác liên kết giữa các màn hình và phản hồi rõ với thao tác.

- Bìa album chuyển liên tục từ thẻ sang mini player rồi Now Playing; mở/thu player có hình học liên tục và spring có kiểm soát.
- Trang và danh sách có chuyển cảnh theo hướng điều hướng; xuất hiện theo nhóm, hover/press/drag phản hồi tức thì. Reorder hàng chờ giữ vị trí các bài dễ theo dõi.
- Liquid Glass có highlight và biến dạng nhẹ khi kéo/nhấn; nền có chiều sâu, chuyển màu, ánh sáng hoặc ảnh động khi người dùng bật.
- Lyrics cuộn theo câu với nhấn sáng, lựa chọn hiệu ứng theo từ khi có timestamp phù hợp. Không kéo timeline giả khi dữ liệu lyrics không khớp.
- Kéo bài lên làm thẻ nhấc khỏi danh sách, ô PC phát sáng khi sẵn sàng nhận, thẻ thu vào đích sau khi thả. PC hiện thẻ nhận bài và nhập hàng chờ sau xác nhận; animation thành công không xuất hiện trước khi thao tác thật hoàn tất.
- DJ có hai deck, waveform nếu đã phân tích, beat marker và hiệu ứng thể hiện quá trình chuyển thật. Hình ảnh lấy từ trạng thái playback, không tự giả đồng bộ với nhạc.
- Có thanh mức chuyển động và preset Đầy đủ / Cân bằng / Tiết kiệm / Giảm chuyển động. Người dùng tùy chỉnh riêng chuyển cảnh, nền động, lyrics và visualizer.
- Mặc định đề xuất: hiệu ứng đầy đủ khi app hiển thị; tôn trọng cài đặt giảm chuyển động của hệ điều hành. Khi dùng pin, có tùy chọn tự chuyển preset; không tự hạ chất lượng âm thanh chỉ vì giảm hiệu ứng hình ảnh.
- Mục tiêu kiểm chứng: chuyển cảnh phổ biến ổn định ở 60 fps trên bộ thiết bị thử; chế độ tần số cao chỉ bật theo màn hình và khả năng máy đã đo. Không hứa 120 fps trên mọi thiết bị.
- Không render animation, visualizer, lyrics hoặc blur động cho cửa sổ/màn hình không hiển thị. Không để các vòng lặp animation giữ hoạt động phát nền khi không cần thiết.

## 9. Kiến trúc và năng lượng

- Rust dùng cho dữ liệu/thư viện, hàng chờ, giao thức đồng bộ và LAN, cache, kế hoạch DJ, adapter gọi LLM. API native đảm nhiệm phần hệ thống cần thiết.
- Android: khảo sát Media3 trong service native cho playback nền và media session. Windows: khảo sát backend âm thanh và tích hợp hệ thống; Tauri là ứng viên UI, chưa coi đã chốt hoặc chứng minh nhẹ nhất.
- Tách UI khỏi vòng đời phát nhạc. Audio-only khi nghe nhạc; quản lý decoder, buffer, retry, audio focus và tài nguyên khi pause/stop. Offload chỉ dùng khi đường phát thực tế hỗ trợ.
- Giới hạn phân tích, tải trước, discovery, kết nối và công việc nền. Nền tắt màn hình không chạy lại cả bộ phân tích thư mục hoặc gửi cập nhật UI.
- Đo CPU, RAM, wakeup, tải mạng, frame time và năng lượng trên thiết bị thật. So sánh cùng nội dung, codec, mạng, đầu ra, âm lượng và thời lượng với SimpMusic; không kết luận dựa vào tên ngôn ngữ.

## 10. Mốc triển khai và nghiệm thu

1. Khảo sát playback hai nền tảng, quyền/khả năng Spotify, LAN và chi phí hiệu ứng kính. Chọn stack UI/backend bằng prototype nhỏ có đo đạc.
2. Lõi local player, thư viện, hàng chờ, khôi phục, loudness/EQ, crossfade và nền ổn định; dựng hệ theme và animation xuyên suốt.
3. Account, liên kết nguồn, sync, handoff, remote, ghép đôi và kéo thả LAN; hoàn thiện offline và xử lý xung đột.
4. AI DJ trên local, preview/phản hồi, kiểm soát key/ngân sách; mở rộng nguồn được phép, playlist thông minh và hoàn thiện tiện ích nền tảng.

Nghiệm thu phải bao gồm:

- Nghe nền/tắt màn hình, cuộc gọi, tai nghe, sleep/resume Windows, mất mạng, hết token và khôi phục phiên.
- Handoff thành công/thất bại; máy đích không có file/quyền phát; lệnh cũ, nhấn lặp và hai máy sửa hàng chờ offline.
- LAN qua Wi-Fi/Ethernet, router cô lập, multicast bị chặn, quyền bị từ chối, PC firewall; thiết bị lạ không gửi lệnh/file được.
- Truyền nhiều file, file trùng tên, tên chứa đường dẫn, hết dung lượng, hủy, retry và hash không khớp; không nhận file lỗi vào thư viện.
- Theme toàn app, override/reset/undo, cỡ chữ lớn, giảm chuyển động, thiết bị yếu và cửa sổ ẩn. Kiểm tra animation khớp trạng thái thật.
- DJ với nhạc khác tempo, không có beat rõ, intro dài, bản live, bài ngắn, API chậm/lỗi và đổi hàng chờ giữa lúc chuẩn bị. So sánh nghe thử có kiểm soát với AutoMix không LLM.
- Kiểm tra log/bản sao lưu không chứa token/key; đo hiệu năng và năng lượng trước khi khẳng định mục tiêu tiết kiệm đã đạt.

### Cập nhật và website

Ứng dụng tự kiểm tra release khi mở và khi đang sử dụng. Popup kính mờ trên Android và Windows hiển thị phiên bản mới, nút tải/cài và lựa chọn để sau. Kiểm tra dung lượng và SHA-256 trước khi mở trình cài đặt. Website `veluna.siloneedsleep.xyz` dùng icon app, có liên kết từ portfolio và tải trực tiếp đúng asset khi release chính thức mới nhất có đủ hai bộ cài.

## 11. Nguồn tham chiếu và ràng buộc đã kiểm tra

- [SimpMusic](https://github.com/maxrave-dev/SimpMusic): Kotlin/Compose, Android và desktop; [GPL-3.0](https://github.com/maxrave-dev/SimpMusic/blob/dev/LICENSE). Nếu phân phối bản dựa trên code, phải đáp ứng nghĩa vụ giấy phép và mã nguồn tương ứng.
- [Spotify Developer Policy](https://developer.spotify.com/policy): quyền streaming Premium, tích hợp dịch vụ khác, DJ/mix và AI. [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes): giới hạn API development và điều kiện mở rộng. Đây là ràng buộc khả thi, không phải tính năng đã giải quyết.
- [Chất lượng Spotify](https://support.spotify.com/uk/article/audio-quality/) và [YouTube Music](https://support.google.com/youtubemusic/answer/9076559?hl=en): quyền chất lượng tùy dịch vụ/tài khoản; chất lượng ứng dụng chính thức không bảo đảm SDK bên thứ ba tương đương.
- [Android NSD](https://developer.android.com/develop/connectivity/wifi/use-nsd): phát hiện dịch vụ LAN. [Local network permission](https://developer.android.com/privacy-and-security/local-network-permission): kiểm tra yêu cầu quyền theo Android/target SDK khi triển khai.
- [MediaSessionService](https://developer.android.com/media/media3/session/background-playback), [audio offload](https://developer.android.com/media/media3/exoplayer/track-selection#audio-offload) và [Tauri](https://v2.tauri.app/start/): nguồn khảo sát tích hợp và benchmark, không phải bằng chứng app đã hoạt động.

Mọi giới hạn dịch vụ và phiên bản API cần kiểm tra lại khi triển khai. Không có thay đổi cloud, tạo account, đăng ký dịch vụ, phát hành hoặc triển khai app trong bước ghi đặc tả này.

## 12. Bằng chứng upstream và các điểm còn mở

- Đã đọc code upstream tại SimpMusic commit `f78a4fd6da9680e5771f4763194d2895d26914fd` và core submodule `8413a257cbe45d102a9f101f2760e35b549e4d9e`. Đây là bằng chứng tĩnh tại thời điểm trao đổi, không phải code đã chép vào VelunaMusic hoặc kết quả chạy thử.
- [Cài đặt crossfade](https://github.com/maxrave-dev/SimpMusic/blob/f78a4fd6da9680e5771f4763194d2895d26914fd/composeApp/src/commonMain/kotlin/com/maxrave/simpmusic/ui/screen/home/SettingScreen.kt#L1603): thời lượng, DJ mode, tùy chọn album, trạng thái khi Cast.
- [Android adapter](https://github.com/maxrave-dev/core/blob/8413a257cbe45d102a9f101f2760e35b549e4d9e/media/media3/src/main/java/com/maxrave/media3/exoplayer/CrossfadeExoPlayerAdapter.kt#L79) và [desktop adapter](https://github.com/maxrave-dev/core/blob/8413a257cbe45d102a9f101f2760e35b549e4d9e/media/media-jvm/src/main/java/com/simpmusic/media_jvm/mpv/MpvPlayerAdapter.kt#L64): đã có code chuẩn bị bài và crossfade qua ExoPlayer/mpv. Rust cần port hoặc tích hợp tương ứng, không tự tái sử dụng nguyên code Kotlin.
- [TrackStructureAnalyzer](https://github.com/maxrave-dev/core/blob/8413a257cbe45d102a9f101f2760e35b549e4d9e/domain/src/commonMain/kotlin/com/maxrave/domain/mediaservice/automix/TrackStructureAnalyzer.kt) và [TransitionPlanner](https://github.com/maxrave-dev/core/blob/8413a257cbe45d102a9f101f2760e35b549e4d9e/domain/src/commonMain/kotlin/com/maxrave/domain/mediaservice/automix/TransitionPlanner.kt): ước lượng tempo/beat/section và điểm chuyển đã tồn tại; không suy diễn rằng engine đã nhận diện giọng hát, tách stem hoặc mix tối ưu mọi thể loại.
- Chưa chốt UI framework, cơ chế auth cụ thể, Windows audio backend, danh sách phiên bản OS tối thiểu, model/provider LLM, chi phí vận hành, ngưỡng năng lượng và bộ thiết bị benchmark. Các lựa chọn này thuộc bước khảo sát, không được tự ghi thành yêu cầu người dùng đã duyệt.
- Không có yêu cầu đồng bộ hai máy phát âm thanh chính xác cùng lúc; ưu tiên đã chọn là handoff và remote. Không có yêu cầu đo khoảng cách vật lý hay con trỏ xuyên màn hình; tính năng gần nhau được cụ thể hóa bằng thiết bị đã ghép đôi và LAN kết nối được.

## 13. Icon và nhận diện đã chọn

- Người dùng đã chọn ảnh nốt nhạc kính xanh dương trên nền xanh đậm làm icon VelunaMusic cho Android và Windows. Giữ nguyên tông tối, hình dáng, nền, bố cục và ánh phản chiếu của ảnh được cung cấp; không tự đổi sang mẫu khác hoặc tăng sáng.
- Ảnh master đã nhập vào dự án: `assets/branding/velunamusic-icon-master.png` (đường dẫn tính từ thư mục gốc dự án). Định dạng PNG, 2048 × 2048 pixel, 1.386.704 byte; đây là bản sao nguyên vẹn của file người dùng cung cấp.
- File nguồn: `app-icon--flat-front-facing-full-bleed-square-artw.png`. SHA-256 của bản master: `927b20a93629426ffd748a90c2c8d93817ebb4e7e2f7fa37554fef719dff65fa`.
- Dùng master làm nguồn chung để tạo các kích thước/icon nền tảng khi đã chọn framework và cấu trúc build. Bản master hiện được giữ vuông, chưa bo góc sẵn; xử lý mask theo nền tảng trong bước đóng gói.
- Icon đã chọn hiện có trong launcher Android, ICO Windows và favicon website. Cần kiểm tra mask thích ứng và độ rõ trên thiết bị thực.

---

# English

## 1. Goals and current status

One product with Android and Windows applications, initially for personal use and a small group. Shared application logic uses Rust, with Kotlin and native platform APIs allowed for system integration. Use SimpMusic as a reference for the library, playback, and AutoMix capabilities.

All feature groups are in scope for the first release. Android and Windows development takes place on `codex/dev`. Publish installers and enable public downloads after validating the complete specification, including accounts, handoff and AI DJ.

Three priorities: reliable listening, extensive personalization, and low energy consumption during background playback. The visible application should have expressive animation; unnecessary work must stop when it moves into the background.

Confirmed user choices: one product with Android/Windows versions; a Rust core with native integration; YouTube and local music plus Spotify; personal/small-group release first; prioritize in-app Spotify playback; handoff and remote control with one primary playback device. Details labeled “proposed,” the UI framework, LLM provider/model, and benchmark thresholds are not final decisions. Supabase in Singapore hosts VelunaMusic accounts.

## 2. Music sources, library, and quality

- Support YouTube/YouTube Music, local music, and Spotify integration. In-app Spotify playback is a priority requirement whose feasibility must be investigated before promising support.
- Provide unified search, clear source labels, favorites, albums, artists, playlists, and a queue. Mixed-source playlists depend on each service's capabilities and conditions; permission to include Spotify in a mixed-source player has not been established.
- Distinguish original, live, remix, and other recordings. Let users review and correct cross-source matches and remember their choice for each version. Source changes must be visible to the listener.
- Smart playlists use data the application is permitted to process: genre, duration, recent listening, and energy when suitable analysis is available. Support listening sessions with an energy progression over time.
- Offer “Highest available” quality: select what the source actually makes available to the account and device. Show codec, bitrate, or lossless parameters when known; show an unknown state when the necessary data is unavailable.
- Preserve the user's original goal: accounts without Premium should receive the best quality they can access. Describe source entitlements honestly; Premium-equivalent quality without Premium has not been established.
- A VelunaMusic account does not grant service Premium entitlements. Do not promise Spotify Premium/lossless or Premium YouTube Music streams to accounts without the required access. Increasing bitrate or changing format after decoding does not restore lost detail.
- Caching, offline playback, and downloads apply only to content and sources that permit them. Provide storage limits, usage by data type, and separate cleanup controls for music, backgrounds, cache, and DJ analysis.
- Export and restore playlists, library data, themes, and settings, clearly identifying which media is included. Ordinary backups must exclude API keys and sign-in tokens.

## 3. Playback and platform features

- Playback, pause, seek, shuffle, repeat, queue, lyrics, and sleep timer. Handle calls, audio focus, disconnected headphones, network loss, and expired playback URLs.
- Adjustable crossfade, AutoMix, and an option to preserve transitions within an album. Distinguish overlapping transitions from gapless playback without overlap; verify backend support for both.
- Upstream reference controls include Auto and durations of 1, 2, 3, 5, 8, 10, 12, 15, 20, and 30 seconds, DJ mode, and an album crossfade exclusion. Investigate retaining those controls; show unavailable states for Cast or sources that cannot support the feature.
- Normalize loudness between tracks when measurements are available, maintain mixing headroom, and protect against clipping. Do not claim accurate normalization before the track has been analyzed.
- Output-specific audio profiles keep EQ, volume, and related settings local to each device. Allow manual profile selection if output identification is unreliable.
- Restore the queue, track, position, style, and DJ plan after reopening. Proposed default: restore paused and offer a resume action.
- Windows: system tray, mini player, media keys, customizable shortcuts, and output selection where supported by the backend.
- Android: media notification, lock-screen controls, headset buttons, widgets, and customizable gestures; retain Android Auto in the roadmap.
- Support large text, contrast controls, adequate touch targets, keyboard navigation, and reduced motion.

## 4. Accounts, service linking, and synchronization

- A VelunaMusic account manages devices, app-owned playlists, favorites, history, themes, and listening-session information. Local playback remains available without signing in.
- Link services through flows they support, separating VelunaMusic identity from each source's identity and playback entitlements. Do not collect service passwords through an app-owned form.
- Each device obtains appropriate access; library synchronization must not be implemented by copying raw tokens or cookies between devices. Provide service unlinking, device revocation, and related data deletion as required by the service.
- Synchronize the library, themes, queue, and playback anchors. Keep volume, output selection, file permissions, and device-specific layouts separate. Let users select which theme settings synchronize.
- Use one primary playback device during a handoff session. The target verifies source/file availability, entitlements, and seek support; the original device stops only after the target confirms readiness. A failed handoff preserves the original session and explains the failure.
- Bidirectional remote control covers play/pause, next/previous, seek, queue, and target volume. Always identify the playback device and show pending, successful, or failed operations.
- Save offline actions and synchronize them later. Use operation identity and versions to prevent duplicate additions or stale commands overwriting a newer session. Offer a resolution interface for concurrent changes that cannot be reconciled automatically.
- Synchronize events and time anchors rather than every frame or frequent progress polling. Reflect actual connectivity and support reconnection when Android enters deep sleep or the system stops the application.
- Account-data synchronization and direct LAN media transfers are separate flows. Previously paired devices can use LAN without internet when their file access and playback entitlements remain valid.

## 5. Drag tracks from a phone to a PC on the local network

### User experience

- Both devices run VelunaMusic, are paired, and can communicate over LAN. An Ethernet-connected PC can participate when it is reachable from the phone's Wi-Fi network.
- Long-press one or more tracks on the phone to reveal available PC targets. Drop onto a PC target, with actions for “Play now,” “Play next,” “Add to queue,” and “Transfer file only” where applicable.
- Proposed default: an ordinary drop appends to the queue to preserve current playback. Separate drop zones let the user choose other actions explicitly.
- This is a drag gesture within the phone interface targeting a PC. It does not promise one continuous pointer or finger gesture across physically separate displays.
- Online tracks send source identifiers and queue requests. The PC resolves and plays them using its own access; the operation does not transfer DRM files or share Premium entitlements.
- Local tracks transfer the selected original files, preserve metadata, and verify integrity. In the first version, a partially received file is not considered ready to play.
- Show progress, cancellation, retry, and receipt status on both devices. Deduplicate by content identity, and never overwrite an existing file solely because its filename matches. Resuming interrupted transfers is proposed.

### Connectivity and trust

- Discover services using mDNS/DNS-SD or Android NSD while the device panel or drag interaction is active. Stop active discovery when leaving that interface; active playback/transfer sessions retain their necessary connections.
- Initially pair through a QR code or expiring short code, with confirmation at both ends. Subsequent connections must be encrypted and authenticate device identity; support unpairing.
- Determine LAN availability through actual connectivity. A shared SSID or discovery-list entry is not proof of trust. LAN discovery does not establish precise physical distance.
- Automatically accept only from trusted devices when receiving is enabled. Notify the user of incoming tracks; place files in the application's media directory and never execute received content.
- If multicast is blocked but unicast works, provide direct pairing/connection through QR. Explain connection failures caused by client isolation, VPNs, or firewalls and offer retry guidance; QR cannot bypass a blocked network path.
- Request local-network and file permissions according to the actual Android version and target SDK, and handle denial/revocation. Handle Windows firewall rules through the installation/application flow without disabling the firewall.

## 6. AI DJ

- Provide a dedicated DJ page. Users select an album/local folder or a source they are allowed to analyze, choose a style, and supply their own LLM API key. Support provider/model selection; no specific model is finalized.
- Analyze audio on the device to estimate tempo, beat grid, energy, intro/outro, and candidate transition points. These are estimates; expose low-confidence results.
- The engine generates bounded transition candidates; the LLM selects among them using measured features and the session goal. Exact beat positions must not be inferred from song titles alone.
- Prepare plans as soon as the next track pair is known, ahead of its transition window. Cache by content, analysis version, track pair, style, and model. Recompute only affected plans when the queue changes.
- Require structured LLM output that the app can validate: an existing candidate, valid timing, and permitted tempo/EQ/volume limits. The Rust engine executes the transition locally at the correct time; late responses must not rewrite a transition already in progress.
- Fall back to local AutoMix on API errors, exhausted budgets, network loss, or invalid plans. LLM work must never block the audio thread.
- Provide gentle, preserve-track, and party styles; preserve album order or optionally reorder a folder. Intervention ranges from volume-only transitions to tempo/EQ adjustments. Cutting track sections requires a corresponding user choice.
- Offer transition previews, manual edits, and feedback such as “good,” “vocals overlap,” and “cuts too early.” Use feedback for future choices without promising that an LLM always outperforms heuristics.
- Store API keys in each device's secure storage; do not log them or automatically synchronize them through the account. Let users choose what is sent; the proposed default sends minimal features rather than uploading the entire audio folder.
- AI settings include provider/model selection and a key/connection check. Only LLM-assisted AI DJ requires a key; ordinary playback and local AutoMix remain usable without one. Distinguish the added LLM feature from SimpMusic's existing AutoMix.
- Provide request limits, estimated budgets, actual usage reported by the API, and an AI off switch. Unknown costs must not appear as exact measurements.
- Cache analysis once; offer bulk analysis while charging. Benchmark local AutoMix against LLM-assisted choices using music that may be analyzed.
- Spotify DJ is constrained by policies concerning mixing/overlap, content analysis, and AI ingestion. Do not enable those functions for Spotify without appropriate permission; Premium does not automatically grant it.

## 7. Liquid Glass and customization throughout the interface

- A global theme covers the sidebar, navigation, mini player, Now Playing, album/playlist cards, search, menus, dialogs, buttons, sliders, and other app-rendered surfaces.
- Components either inherit the global theme or have their own overrides. Global changes affect inherited values only; support component-level and full-theme resets.
- Customize transparency, blur, tint, borders, highlights, shadows, corner radius, and motion. Text, icons, and lyrics have independent color, size, and contrast settings. Users choose glass or solid surfaces per component.
- Customize fonts, typography, and device-specific layout. Apply accent and theme colors consistently; presentation changes do not change music metadata or source entitlements.
- Custom backgrounds support cropping/positioning, blur, and dark overlays. Allow per-playlist themes and opt-in artwork-derived colors; process images once and cache display-appropriate versions.
- Direct editing lets users select a component, preview changes immediately, undo/redo, and reset. Provide clear-glass, frosted-glass, dark-glass, and solid presets; support saving, importing/exporting, and synchronizing themes.
- Reorder or hide home sections and select minimal, artwork-focused, or lyrics-focused players. Adapt layouts to Android and Windows.
- Keep text readable and hit targets stable in every preset. System-owned permission sheets, keyboards, and notifications remain subject to platform customization limits.

## 8. Expressive animation

Confirmed requirement: rich animation while the application is visible, continuous relationships between screens, and clear responses to user interaction.

- Transition album artwork continuously from a card into the mini player and Now Playing; expand/collapse the player through coherent geometry and controlled spring motion.
- Match page transitions to navigation direction. Animate list groups and respond immediately to hover, press, and drag. Queue reordering must keep track positions easy to follow.
- Give Liquid Glass reactive highlights and subtle deformation during interaction. Offer depth, color transitions, lighting, or animated backgrounds when enabled.
- Scroll and highlight lyrics by line, with optional word effects when valid timestamps are available. Do not fabricate synchronization when lyrics data is incorrect.
- Lift dragged track cards from the list, highlight ready PC targets, and animate the card into its destination on drop. The PC shows a receipt card and queues the track after acknowledgment; success animation must reflect an actually completed operation.
- DJ includes two decks, waveforms when analyzed, beat markers, and visual transitions tied to real playback state. Do not fake beat synchronization.
- Offer a motion-intensity control and Full / Balanced / Power saving / Reduced motion presets. Allow separate control over navigation, backgrounds, lyrics, and visualizers.
- Proposed default: full effects while visible, respecting system reduced-motion settings. Offer automatic preset changes on battery power; reducing visual effects does not automatically lower audio quality.
- Verification target: common transitions sustain 60 fps on the test-device set. High-refresh modes depend on the display and measured device capability; 120 fps is not promised for every device.
- Stop rendering animation, visualizers, lyrics, and dynamic blur for hidden windows/screens. Unnecessary animation loops must not keep background playback active.

## 9. Architecture and energy use

- Rust owns library/data logic, queues, synchronization and LAN protocols, cache, DJ planning, and LLM adapters. Native APIs handle necessary system integration.
- Android: investigate Media3 in a native service for background playback and media sessions. Windows: investigate the audio backend and system integration. Tauri is a UI candidate, not a finalized choice or a proven lowest-energy option.
- Separate UI lifetime from playback lifetime. Use audio-only streams for music, and manage decoders, buffers, retries, audio focus, and pause/stop resources. Use audio offload only when the actual playback path supports it.
- Bound analysis, preloading, discovery, connections, and background work. Screen-off playback must not repeatedly analyze an entire folder or send UI updates.
- Measure CPU, RAM, wakeups, network traffic, frame times, and energy on real devices. Compare against SimpMusic using the same content, codec, network, output, volume, and duration; language choice alone is not evidence of energy savings.

## 10. Delivery milestones and acceptance

1. Investigate playback on both platforms, Spotify entitlements/feasibility, LAN, and glass-rendering costs. Select the UI/audio stack using small measured prototypes.
2. Implement the local player, library, queue, restoration, loudness/EQ, crossfade, and reliable background playback; establish the shared theme and animation system.
3. Implement accounts, service linking, synchronization, handoff, remote control, pairing, and LAN drag-and-drop; complete offline operation and conflict handling.
4. Add local AI DJ, previews/feedback, key/budget controls; extend to permitted sources, smart playlists, and remaining platform features.

Acceptance must cover:

- Background/screen-off playback, calls, headphones, Windows sleep/resume, network loss, token expiry, and session restoration.
- Successful/failed handoffs, missing target files/entitlements, stale commands, repeated actions, and concurrent offline queue edits.
- LAN over Wi-Fi/Ethernet, client isolation, blocked multicast, permission denial, and PC firewall behavior; unknown devices cannot submit commands/files.
- Multiple-file transfers, duplicate names, path-containing filenames, insufficient storage, cancellation, retry, and hash mismatches; incomplete/corrupt files stay out of the library.
- Global themes, overrides/reset/undo, large text, reduced motion, lower-powered devices, and hidden windows. Verify that animation follows actual state.
- DJ behavior across tempo differences, unclear beats, long intros, live recordings, short tracks, delayed/failed APIs, and queue changes during preparation. Conduct controlled listening comparisons against AutoMix without an LLM.
- Logs/backups must exclude keys/tokens. Measure performance and energy before claiming that efficiency targets have been met.

### Updates and website

Check for a newer stable release at launch and during use. A frosted-glass popup on both platforms offers to install or defer the update. Verify size and SHA-256 before starting the system installer. The website at `veluna.siloneedsleep.xyz` uses the app icon, is linked from the portfolio and downloads the matching asset when the latest stable release contains both installers.

## 11. References and verified constraints

- [SimpMusic](https://github.com/maxrave-dev/SimpMusic): Kotlin/Compose, Android, and desktop; [GPL-3.0](https://github.com/maxrave-dev/SimpMusic/blob/dev/LICENSE). Distributing code-based derivatives requires complying with the applicable license and corresponding-source obligations.
- [Spotify Developer Policy](https://developer.spotify.com/policy): Premium streaming, other-service integration, DJ/mixing, and AI restrictions. [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes): development limits and expansion requirements. These are feasibility constraints, not solved features.
- [Spotify audio quality](https://support.spotify.com/uk/article/audio-quality/) and [YouTube Music quality](https://support.google.com/youtubemusic/answer/9076559?hl=en): quality depends on service/account entitlements; official-app quality does not establish equivalent third-party SDK support.
- [Android NSD](https://developer.android.com/develop/connectivity/wifi/use-nsd): LAN service discovery. [Local network permission](https://developer.android.com/privacy-and-security/local-network-permission): verify Android/target SDK requirements during implementation.
- [MediaSessionService](https://developer.android.com/media/media3/session/background-playback), [audio offload](https://developer.android.com/media/media3/exoplayer/track-selection#audio-offload), and [Tauri](https://v2.tauri.app/start/): investigation and benchmark references, not evidence that VelunaMusic already runs.

Recheck service restrictions and API versions during implementation. This specification update does not create cloud resources/accounts, register services, publish, or deploy the application.

## 12. Upstream evidence and open decisions

- Upstream code was read at SimpMusic commit `f78a4fd6da9680e5771f4763194d2895d26914fd` and core submodule `8413a257cbe45d102a9f101f2760e35b549e4d9e`. This is static evidence from the discussion, not code copied into VelunaMusic or runtime validation.
- [Crossfade settings](https://github.com/maxrave-dev/SimpMusic/blob/f78a4fd6da9680e5771f4763194d2895d26914fd/composeApp/src/commonMain/kotlin/com/maxrave/simpmusic/ui/screen/home/SettingScreen.kt#L1603): durations, DJ mode, album behavior, and Cast availability.
- [Android adapter](https://github.com/maxrave-dev/core/blob/8413a257cbe45d102a9f101f2760e35b549e4d9e/media/media3/src/main/java/com/maxrave/media3/exoplayer/CrossfadeExoPlayerAdapter.kt#L79) and [desktop adapter](https://github.com/maxrave-dev/core/blob/8413a257cbe45d102a9f101f2760e35b549e4d9e/media/media-jvm/src/main/java/com/simpmusic/media_jvm/mpv/MpvPlayerAdapter.kt#L64): track preparation and crossfade implementations exist for ExoPlayer/mpv. A Rust architecture requires an appropriate port or integration, rather than directly reusing Kotlin source unchanged.
- [TrackStructureAnalyzer](https://github.com/maxrave-dev/core/blob/8413a257cbe45d102a9f101f2760e35b549e4d9e/domain/src/commonMain/kotlin/com/maxrave/domain/mediaservice/automix/TrackStructureAnalyzer.kt) and [TransitionPlanner](https://github.com/maxrave-dev/core/blob/8413a257cbe45d102a9f101f2760e35b549e4d9e/domain/src/commonMain/kotlin/com/maxrave/domain/mediaservice/automix/TransitionPlanner.kt): tempo/beat/section estimates and transition placement already exist. This does not establish vocal detection, stem separation, or optimal mixing for every genre.
- Open choices include the UI framework, concrete authentication flow, Windows audio backend, minimum OS versions, LLM model/provider, operating costs, energy thresholds, and benchmark-device set. Resolve these through investigation; do not represent them as previously approved user requirements.
- Precisely synchronized simultaneous playback on two devices is not a current requirement; the chosen priority is handoff and remote control. Physical distance measurement and a pointer spanning displays are not requirements; nearby-device interaction is defined as paired devices with working LAN connectivity.
## 13. Selected icon and branding

- The user selected the supplied blue-glass musical note on a dark-blue background as the VelunaMusic icon for Android and Windows. Preserve the supplied dark palette, shape, background, composition, and reflections; do not substitute another concept or brighten it automatically.
- Imported master asset: `assets/branding/velunamusic-icon-master.png` (relative to the project root). PNG format, 2048 × 2048 pixels, 1,386,704 bytes; this is an unchanged copy of the user-supplied file.
- Source filename: `app-icon--flat-front-facing-full-bleed-square-artw.png`. Master SHA-256: `927b20a93629426ffd748a90c2c8d93817ebb4e7e2f7fa37554fef719dff65fa`.
- Use this master as the common source for platform icon sizes after the framework and build structure are selected. The master remains square without pre-applied rounded corners; apply platform masks during packaging.
- The artwork is integrated into the Android launcher, Windows ICO and website favicon. Verify adaptive masks and small-size legibility on devices.
