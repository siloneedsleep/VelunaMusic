(() => {
  const rootObj = typeof window !== "undefined" ? window : globalThis;

  const PRESET_SPECS = {
    clear: "blur 8px · opacity 18% · saturate 150%",
    frost: "blur 24px · opacity 48% · saturate 160%",
    dark: "blur 14px · opacity 84% · saturate 140%",
    solid: "blur 0px · opacity 100% · solid cobalt"
  };

  const I18N = {
    vi: {
      page_title: "VelunaMusic · Trình phát nhạc đa nền tảng",
      nav_toggle_aria: "Mở menu điều hướng",
      announce_text: "Lõi Rust YouTube Music (Opus/AAC), Liquid Glass 4 preset & Hardware Audio Offload",
      nav_home: "Trang chủ",
      nav_features: "Tính năng",
      nav_showcase: "Giao diện",
      nav_downloads: "Tải xuống",
      nav_faq: "FAQ",
      hero_eyebrow: "Rust Core · Android Media3 · Windows Tauri",
      hero_headline: " Âm thanh chuẩn sắc Chrome & Cobalt Liquid Glass.",
      hero_lead: "Trình phát nhạc đa nền tảng ưu tiên nghe nền tiết kiệm pin, truyền bài tức thì qua LAN và cá nhân hóa toàn bộ bề mặt kính mờ trên Android và Windows.",
      cta_auto: "Tải xuống ngay",
      cta_android: "Tải cho Android (.apk)",
      cta_windows: "Tải cho Windows (.exe)",
      cta_releases: "Xem Releases trên GitHub",
      version_pending: "Nhánh codex/dev",
      hero_disclaimer: "Dự án mã nguồn mở độc lập, không đại diện Google hay Spotify. VelunaMusic không cấp quyền Premium cho tài khoản không có gói dịch vụ tương ứng.",
      mock_library: "Thư viện",
      mock_lan: "Kéo-thả LAN",
      features_kicker: "KIẾN TRÚC TỐI ƯU NĂNG LƯỢNG & ÂM THANH",
      features_title: "6 trụ cột cốt lõi của VelunaMusic",
      f1_title: "Phát nhạc nền & Audio Offload",
      f1_desc: "Android Media3 giữ nhạc chạy ổn định khi tắt màn hình và tự bật hardware audio offload mỗi khi tắt EQ và AutoMix.",
      f2_title: "Đa nguồn YouTube Music & Local",
      f2_desc: "Lõi Rust InnerTube chọn luồng Opus/AAC khả dụng cao nhất, tách rõ Bản gốc / Live / Remix, tự làm mới URL hết hạn và hiển thị thông số thật.",
      f3_title: "Word-timed Lyrics",
      f3_desc: "Cuộn mượt theo câu và làm sáng từng từ khi có timestamp LRC nâng cao hoặc lời đồng bộ, chỉnh bù độ trễ 100 ms cho từng bài.",
      f4_title: "AutoMix & Crossfade",
      f4_desc: "Crossfade tự động hoặc cố định 1–30 giây giữ nguyên chuyển tiếp trong album; kết hợp AI DJ đo nhịp BPM tại máy.",
      f5_title: "Handoff & Kéo-thả LAN",
      f5_desc: "Chuyển phiên phát tiếp sang máy khác hoặc kéo-thả bài hát qua Wi-Fi cùng mạng LAN có kiểm tra tính toàn vẹn SHA-256.",
      f6_title: "Bảo mật tách biệt token",
      f6_desc: "Danh tính Veluna tách rời khỏi nguồn nhạc; tuyệt đối không đồng bộ cookie, mật khẩu hay token thô của dịch vụ lên cloud.",
      showcase_kicker: "TRẢI NGHIỆM TRỰC TIẾP",
      showcase_title: "Thử 4 preset Liquid Glass & Word-timed Lyrics",
      preset_clear: "Kính trong",
      preset_frost: "Kính mờ",
      preset_dark: "Kính tối",
      preset_solid: "Màu đặc",
      showcase_pause: "Tạm dừng demo",
      showcase_play: "Chạy demo",
      downloads_kicker: "PHÁT HÀNH CHÍNH THỨC TRÊN GITHUB RELEASES",
      downloads_title: "Tải VelunaMusic",
      dl_android_btn: "Tải gói cài đặt Android",
      dl_windows_btn: "Tải trình cài đặt Windows",
      dl_a_req1: "Android 8.0+ (API 26) · ARM64 / v8a",
      dl_a_req2: "Media3 phát nền, Widget, Audio Offload",
      dl_a_req3: "Lõi Rust JNI (libveluna_core.so)",
      dl_w_req1: "Windows 10 / 11 (64-bit x64)",
      dl_w_req2: "WebView2 Runtime · Khay hệ thống & Mini Player",
      dl_w_req3: "Nhận file kéo-thả LAN & Remote từ Android",
      dl_verify: "Tất cả bản dựng phát hành chính thức tại github.com/siloneedsleep/VelunaMusic và tự kiểm tra SHA-256 trước khi cập nhật.",
      faq_kicker: "CÂU HỎI THƯỜNG GẶP",
      faq_title: "Giải đáp nhanh về VelunaMusic",
      faq1_q: "VelunaMusic là gì?",
      faq1_a: "VelunaMusic là trình phát nhạc mã nguồn mở (GPL-3.0) chạy trên Android và Windows, kết hợp lõi xử lý Rust hiệu năng cao, phát nhạc nền tiết kiệm điện, YouTube Music InnerTube, lời đồng bộ theo từ và giao diện Liquid Glass tùy biến sâu.",
      faq2_q: "Hỗ trợ những thiết bị nào?",
      faq2_a: "Hỗ trợ điện thoại Android 8.0+ (ARM64-v8a) qua Media3 và máy tính Windows 10/11 64-bit qua WebView2. Hai thiết bị cùng mạng Wi-Fi/LAN có thể ghép đôi QR để kéo-thả file hoặc chuyển phiên phát.",
      faq3_q: "Tải ứng dụng an toàn ở đâu?",
      faq3_a: "Chỉ tải tệp cài đặt chính thức từ trang veluna.siloneedsleep.xyz hoặc mục Releases của kho lưu trữ github.com/siloneedsleep/VelunaMusic. Trình cập nhật tích hợp luôn đối chiếu chữ ký và mã băm SHA-256 trước khi mở bộ cài.",
      faq4_q: "Khác biệt giữa bản Stable và Nightly / Dev là gì?",
      faq4_a: "Bản Stable được phát hành theo thẻ semver (vX.Y.Z) sau khi qua đủ bài kiểm tra playback nền, handoff và SHA-256; còn nhánh codex/dev chứa các tính năng mới nhất đang thử nghiệm trước khi đóng gói phát hành công khai.",
      faq5_q: "Quyền riêng tư dữ liệu và token hoạt động ra sao?",
      faq5_a: "Tài khoản Veluna chỉ lưu playlist, lịch sử phát, giao diện và điều khiển từ xa; tuyệt đối không gửi token, cookie thô của dịch vụ hay API key AI DJ lên máy chủ. Nhạc local phát hoàn toàn offline không cần đăng nhập.",
      comm_kicker: "MÃ NGUỒN MỞ & CỘNG ĐỒNG",
      comm_title: "Đóng góp & Thảo luận",
      comm_github_desc: "Xem mã nguồn Rust/Java/Web, báo lỗi, kiểm tra checksum phát hành và theo dõi nhánh codex/dev.",
      comm_discuss_desc: "Trao đổi preset Liquid Glass, phản hồi kết quả kiểm thử thiết bị Android/Windows và đề xuất tính năng.",
      footer_author: "Phát triển bởi @siloneedsleep · Giấy phép GPL-3.0",
      footer_privacy: "Chính sách bảo mật",
      footer_terms: "Điều khoản sử dụng",
      footer_legal: "VelunaMusic không liên kết với YouTube, Google hay Spotify. Các luồng stream tuân theo giới hạn kỹ thuật và quyền truy cập thực tế của từng tài khoản.",
      privacy_page_title: "VelunaMusic · Chính sách bảo mật",
      terms_page_title: "VelunaMusic · Điều khoản sử dụng"
    },
    en: {
      page_title: "VelunaMusic · Cross-Platform Music Player",
      nav_toggle_aria: "Toggle navigation menu",
      announce_text: "Rust InnerTube YouTube Music (Opus/AAC), 4 Liquid Glass Presets & Hardware Audio Offload",
      nav_home: "Home",
      nav_features: "Features",
      nav_showcase: "Showcase",
      nav_downloads: "Downloads",
      nav_faq: "FAQ",
      hero_eyebrow: "Rust Core · Android Media3 · Windows Tauri",
      hero_headline: " Chrome & Cobalt Liquid Glass precision playback.",
      hero_lead: "A cross-platform music player engineered for low-power background playback, direct LAN transfers, and customizable Liquid Glass surfaces across Android and Windows.",
      cta_auto: "Download Now",
      cta_android: "Download for Android (.apk)",
      cta_windows: "Download for Windows (.exe)",
      cta_releases: "Browse GitHub Releases",
      version_pending: "Branch codex/dev",
      hero_disclaimer: "Independent open-source project, not affiliated with Google or Spotify. VelunaMusic never grants Premium service entitlements without an eligible account.",
      mock_library: "Library",
      mock_lan: "LAN Drop",
      features_kicker: "ENERGY-EFFICIENT ARCHITECTURE & AUDIO",
      features_title: "6 core pillars powering VelunaMusic",
      f1_title: "Background Playback & Audio Offload",
      f1_desc: "Android Media3 keeps audio steady with the screen off and enables hardware audio offload whenever EQ and AutoMix are off.",
      f2_title: "High-Speed YouTube Music & Local Sources",
      f2_desc: "Rust InnerTube picks the highest available Opus/AAC stream, distinguishes Original / Live / Remix, refreshes expired URLs, and shows real stream metrics.",
      f3_title: "Word-Timed Lyrics",
      f3_desc: "Smooth line scrolling and real-time word-by-word highlighting when valid enhanced LRC timestamps are present, with per-track 100 ms offset.",
      f4_title: "AutoMix & Crossfade",
      f4_desc: "Automatic or 1–30s fixed crossfade preserving album transitions, paired with local on-device BPM estimation and optional AI DJ.",
      f5_title: "Playback Handoff & LAN Drag-Drop",
      f5_desc: "Transfer listening sessions cleanly across devices or send tracks over Wi-Fi/LAN with cryptographic SHA-256 verification.",
      f6_title: "Strict Token & Identity Isolation",
      f6_desc: "Veluna accounts remain separate from source credentials; service cookies, raw tokens, and AI keys are never synced to the cloud.",
      showcase_kicker: "INTERACTIVE PREVIEW",
      showcase_title: "Test 4 Liquid Glass presets & word-timed lyrics",
      preset_clear: "Clear Glass",
      preset_frost: "Frosted Glass",
      preset_dark: "Dark Glass",
      preset_solid: "Solid Surface",
      showcase_pause: "Pause demo",
      showcase_play: "Play demo",
      downloads_kicker: "OFFICIAL BUILDS ON GITHUB RELEASES",
      downloads_title: "Download VelunaMusic",
      dl_android_btn: "Download Android Installer",
      dl_windows_btn: "Download Windows Installer",
      dl_a_req1: "Android 8.0+ (API 26) · ARM64 / v8a",
      dl_a_req2: "Media3 Background Playback, Widget & Offload",
      dl_a_req3: "Rust JNI Native Core (libveluna_core.so)",
      dl_w_req1: "Windows 10 / 11 (64-bit x64)",
      dl_w_req2: "WebView2 Runtime · System Tray & Mini Player",
      dl_w_req3: "LAN Drag-Drop Receiver & Android Remote Control",
      dl_verify: "Official installers are published strictly at github.com/siloneedsleep/VelunaMusic with client-side SHA-256 verification.",
      faq_kicker: "FREQUENTLY ASKED QUESTIONS",
      faq_title: "Answers about VelunaMusic",
      faq1_q: "What is VelunaMusic?",
      faq1_a: "VelunaMusic is an open-source (GPL-3.0) music player for Android and Windows combining a shared Rust engine, battery-conscious background playback, YouTube Music InnerTube support, word-timed lyrics, and customizable Liquid Glass themes.",
      faq2_q: "Which devices are supported?",
      faq2_a: "Android 8.0+ phones (ARM64-v8a) via Media3 and Windows 10/11 64-bit PCs via WebView2. Devices on the same Wi-Fi/LAN network can pair via QR code for file transfers and playback handoff.",
      faq3_q: "Where can I safely download installers?",
      faq3_a: "Download only from veluna.siloneedsleep.xyz or the official GitHub Releases page at github.com/siloneedsleep/VelunaMusic. Built-in updates verify file sizes and SHA-256 checksums automatically.",
      faq4_q: "What is the difference between Stable and Nightly / Dev?",
      faq4_a: "Stable builds ship under semver tags (vX.Y.Z) after validating background playback, handoff, and SHA-256 verification; the codex/dev branch holds active pre-release features ahead of public installers.",
      faq5_q: "How are user data and service tokens handled?",
      faq5_a: "Veluna accounts only manage playlists, listening history, themes, and remote control signals. Service cookies, raw access tokens, and AI DJ keys stay strictly on each device, while local playback works fully offline.",
      comm_kicker: "OPEN SOURCE & COMMUNITY",
      comm_title: "Contribute & Connect",
      comm_github_desc: "Inspect Rust/Java/Web sources, file issues, verify release checksums, and track the codex/dev branch.",
      comm_discuss_desc: "Share Liquid Glass presets, device battery measurements, and feature requests with maintainers.",
      footer_author: "Built by @siloneedsleep · Licensed under GPL-3.0",
      footer_privacy: "Privacy Policy",
      footer_terms: "Terms of Service",
      footer_legal: "VelunaMusic is not affiliated with YouTube, Google, or Spotify. Audio streams remain bound by each source's technical limits and account entitlements.",
      privacy_page_title: "VelunaMusic · Privacy Policy",
      terms_page_title: "VelunaMusic · Terms of Service"
    }
  };

  let currentLang = (typeof document !== "undefined" && document.documentElement?.dataset?.defaultLang === "en") ? "en" : "vi";
  try {
    const savedLang = localStorage.getItem("veluna-site-lang");
    if (savedLang === "en" || savedLang === "vi") currentLang = savedLang;
  } catch {}

  let showcasePreset = "frost";
  let showcasePlaying = true;
  let showcaseTime = 1.6;
  let lastTick = 0;
  let showcaseVisible = true;
  let rafShowcase = 0;

  function queryAll(sel) {
    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return [];
    return [...document.querySelectorAll(sel)];
  }

  function queryOne(sel) {
    if (typeof document === "undefined") return null;
    if (typeof document.querySelector === "function") return document.querySelector(sel);
    return null;
  }

  function byId(id) {
    if (typeof document === "undefined" || typeof document.getElementById !== "function") return null;
    return document.getElementById(id);
  }

  function detectOs(uaOverride) {
    const ua = String(uaOverride || (typeof navigator !== "undefined" ? navigator.userAgent : "") || "").toLowerCase();
    const platform = String(typeof navigator !== "undefined" ? (navigator.userAgentData?.platform || navigator.platform || "") : "").toLowerCase();
    if (ua.includes("android") || platform.includes("android")) return "android";
    if (ua.includes("windows") || platform.includes("win")) return "windows";
    return "other";
  }

  function syncDownloadCta(osKind) {
    const os = osKind || detectOs();
    const dict = I18N[currentLang];
    const heroCta = byId("hero-cta");
    const heroLabel = byId("hero-cta-label");
    const androidCard = byId("android");
    const windowsCard = byId("windows");

    if (androidCard?.setAttribute) androidCard.setAttribute("data-recommended", String(os === "android"));
    if (windowsCard?.setAttribute) windowsCard.setAttribute("data-recommended", String(os === "windows"));

    if (os === "android") {
      if (heroLabel) heroLabel.textContent = dict.cta_android;
      if (heroCta && androidCard?.href) heroCta.href = androidCard.href;
      else if (heroCta) heroCta.href = "#downloads";
    } else if (os === "windows") {
      if (heroLabel) heroLabel.textContent = dict.cta_windows;
      if (heroCta && windowsCard?.href) heroCta.href = windowsCard.href;
      else if (heroCta) heroCta.href = "#downloads";
    } else {
      if (heroLabel) heroLabel.textContent = dict.cta_auto;
      if (heroCta) heroCta.href = "#downloads";
    }
  }

  function setLanguage(lang) {
    currentLang = lang === "en" ? "en" : "vi";
    try { localStorage.setItem("veluna-site-lang", currentLang); } catch {}
    const dict = I18N[currentLang];
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.lang = currentLang;
      const titleKey = document.body?.dataset?.pageTitleKey || "page_title";
      document.title = dict[titleKey] || dict.page_title;
    }
    for (const node of queryAll("[data-i18n]")) {
      const k = node.dataset?.i18n;
      if (k && k in dict) node.textContent = dict[k];
    }
    for (const node of queryAll("[data-i18n-aria]")) {
      const k = node.dataset?.i18nAria;
      if (k && k in dict && node.setAttribute) node.setAttribute("aria-label", dict[k]);
    }
    const langBtn = byId("lang-toggle");
    if (langBtn) {
      langBtn.textContent = currentLang === "vi" ? "EN" : "VI";
      langBtn.setAttribute("aria-pressed", String(currentLang === "en"));
    }
    const playBtn = byId("showcase-play");
    if (playBtn) playBtn.textContent = showcasePlaying ? dict.showcase_pause : dict.showcase_play;
    syncDownloadCta();
    if(typeof CustomEvent==="function")document.dispatchEvent(new CustomEvent("veluna-language"));
  }

  function setPreset(name) {
    if (!(name in PRESET_SPECS)) return;
    showcasePreset = name;
    const stage = byId("showcase-stage");
    if (stage?.setAttribute) stage.setAttribute("data-preset", name);
    const metrics = byId("showcase-metrics");
    if (metrics) metrics.textContent = PRESET_SPECS[name];
    for (const btn of queryAll("[data-showcase-preset]")) {
      btn.setAttribute?.("aria-pressed", String(btn.dataset?.showcasePreset === name));
    }
  }

  const timeline=queryAll(".lyric-demo-line").map(line=>({line,start:Number(line.dataset.start),end:Number(line.dataset.end),
    words:Array.from(line.querySelectorAll?.(".w") || [],word=>({word,start:Number(word.dataset.start),end:Number(word.dataset.end)}))}));
  let timelineSecond=-1;
  function renderShowcaseTimeline(timeSec) {
    const duration = 16.0;
    const t = ((timeSec % duration) + duration) % duration;
    const clock = byId("showcase-clock");
    if (clock && timelineSecond!==Math.floor(t)){timelineSecond=Math.floor(t);clock.textContent="0:"+String(timelineSecond).padStart(2,"0");}
    const prog = byId("showcase-progress");
    if (prog?.style?.setProperty) prog.style.transform = "scaleX(" + Math.max(0.02, t / duration).toFixed(3) + ")";

    for(const {line,start,end,words} of timeline){
      line.classList?.toggle("is-current-line",t>=start && t<end);
      for(const entry of words){
        entry.word.classList?.toggle("is-past",t>=entry.end);
        entry.word.classList?.toggle("is-active",t>=entry.start && t<entry.end);
      }
    }
  }

  let onBattery=false;
  function isReducedMotion() {
    return onBattery || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function stepShowcase(now) {
    if (!showcasePlaying || !showcaseVisible || document.hidden || isReducedMotion()) {
      rafShowcase = 0;
      lastTick = 0;
      return;
    }
    if (lastTick) showcaseTime = (showcaseTime + (now - lastTick) / 1000) % 16.0;
    lastTick = now;
    renderShowcaseTimeline(showcaseTime);
    if (typeof requestAnimationFrame === "function") {
      rafShowcase = requestAnimationFrame(stepShowcase);
    }
  }

  function ensureShowcaseLoop() {
    if (rafShowcase || !showcasePlaying || !showcaseVisible || document.hidden || isReducedMotion()) return;
    if (typeof requestAnimationFrame === "function") {
      lastTick = 0;
      rafShowcase = requestAnimationFrame(stepShowcase);
    }
  }

  function togglePlay() {
    showcasePlaying = !showcasePlaying;
    const playBtn = byId("showcase-play");
    const dict = I18N[currentLang];
    if (playBtn) {
      playBtn.setAttribute("aria-pressed", String(showcasePlaying));
      playBtn.textContent = showcasePlaying ? dict.showcase_pause : dict.showcase_play;
    }
    if (showcasePlaying) ensureShowcaseLoop();
  }

  function bindTilt() {
    const stage = byId("mockup-stage");
    if (!stage || isReducedMotion() || typeof stage.addEventListener !== "function") return;
    let rafTilt = 0;
    let nextX = 0;
    let nextY = 0;
    stage.addEventListener("pointermove", e => {
      if (document.hidden || isReducedMotion() || e.pointerType === "touch") return;
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      nextX = (((e.clientX - rect.left) / rect.width) - 0.5) * 14;
      nextY = (0.5 - ((e.clientY - rect.top) / rect.height)) * 12;
      if (!rafTilt && typeof requestAnimationFrame === "function") {
        rafTilt = requestAnimationFrame(() => {
          rafTilt = 0;
          document.documentElement?.style?.setProperty("--tilt-x", nextX.toFixed(2) + "deg");
          document.documentElement?.style?.setProperty("--tilt-y", nextY.toFixed(2) + "deg");
        });
      }
    }, { passive: true });
    stage.addEventListener("pointerleave", () => {
      document.documentElement?.style?.setProperty("--tilt-x", "0deg");
      document.documentElement?.style?.setProperty("--tilt-y", "0deg");
    });
  }

  function setupReveal() {
    const targets = queryAll("[data-reveal]");
    if (!targets.length) return;
    if (typeof IntersectionObserver !== "function" || isReducedMotion()) {
      for (const el of targets) el.classList?.add("is-visible");
      return;
    }
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList?.add("is-visible");
          io.unobserve(entry.target);
        }
      }
    }, { threshold: 0.12 });
    for (const el of targets) io.observe(el);

    const showcase = byId("showcase-stage");
    if (showcase) {
      const scIo = new IntersectionObserver(entries => {
        showcaseVisible = !!entries[0]?.isIntersecting;
        if (showcaseVisible) ensureShowcaseLoop();
      }, { threshold: 0.05 });
      scIo.observe(showcase);
    }
  }

  function observeReleaseStatus() {
    const statusEl = byId("status");
    const heroVer = byId("hero-version");
    const annTag = byId("announce-tag");
    const syncVer = () => {
      const m = statusEl?.textContent?.match(/v\d+\.\d+\.\d+/);
      if (m) {
        if (heroVer) heroVer.textContent = m[0];
        if (annTag) annTag.textContent = m[0];
      }
      syncDownloadCta();
    };
    if (typeof MutationObserver === "function" && statusEl) {
      new MutationObserver(syncVer).observe(statusEl, { childList: true, characterData: true, subtree: true });
    }
  }

  const langBtn = byId("lang-toggle");
  if (langBtn) langBtn.onclick = () => setLanguage(currentLang === "vi" ? "en" : "vi");

  for (const btn of queryAll("[data-showcase-preset]")) {
    btn.onclick = () => setPreset(btn.dataset?.showcasePreset);
  }

  const playBtn = byId("showcase-play");
  if (playBtn) playBtn.onclick = togglePlay;

  for (const line of queryAll(".lyric-demo-line")) {
    line.onclick = () => {
      showcaseTime = Number(line.dataset?.start || 0) + 0.05;
      renderShowcaseTimeline(showcaseTime);
    };
  }

  const navToggle = byId("nav-toggle");
  const primaryNav = byId("primary-nav");
  if (navToggle && primaryNav) {
    navToggle.onclick = () => {
      const open = !primaryNav.classList.contains("is-open");
      primaryNav.classList.toggle("is-open", open);
      navToggle.setAttribute("aria-expanded", String(open));
    };
    for (const link of queryAll("#primary-nav a")) {
      link.addEventListener?.("click", () => {
        primaryNav.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    }
  }

  const headerEl = queryOne(".site-header");
  if (typeof rootObj.addEventListener === "function") {
    rootObj.addEventListener("scroll", () => {
      if (headerEl) headerEl.classList?.toggle("is-scrolled", (rootObj.scrollY || 0) > 24);
    }, { passive: true });
  }

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (document.body?.dataset) document.body.dataset.hidden = String(!!document.hidden);
      if(document.hidden && rafShowcase && typeof cancelAnimationFrame==="function"){cancelAnimationFrame(rafShowcase);rafShowcase=lastTick=0;}
      if (!document.hidden) ensureShowcaseLoop();
    });
  }

  if(typeof navigator!=="undefined" && navigator.getBattery)navigator.getBattery().then(battery=>{
    const update=()=>{onBattery=!battery.charging;document.body.dataset.battery=String(onBattery);if(!onBattery)ensureShowcaseLoop();};
    battery.addEventListener("chargingchange",update);update();
  }).catch(()=>{});
  setLanguage(currentLang);
  setPreset("frost");
  renderShowcaseTimeline(showcaseTime);
  setupReveal();
  bindTilt();
  observeReleaseStatus();
  ensureShowcaseLoop();

  rootObj.velunaSite = {
    setLanguage,
    setPreset,
    detectOs,
    togglePlay,
    renderShowcaseTimeline,
    getLang: () => currentLang,
    getPreset: () => showcasePreset
  };
})();
