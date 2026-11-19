# VelunaMusic — Implementation Changelog (`codex/dev`)

## 2026-11-19 · Android service, Windows and queue synchronization

- PlaybackService, RemotePlayback, CloudSession, NativeHandoff, CommandInbox and PlaybackJournal own authenticated subscriptions, ordered command delivery, account refresh, seekable-source preparation, queue restoration and cleanup. Audio offload stays under the existing EQ/AutoMix policy.
- The background playback migration publishes handoff and command changes. The mailbox uses RLS, bounded expiry and idempotent writes. Local outboxes survive reconnect and expose conflicts for re-selection.
- Windows gained asynchronous typed YouTube Music commands, a persistent online library, a loopback-only streaming endpoint with a random capability, restricted origin checks and single-range forwarding and authenticated LAN references. File digests, metadata and audio analysis share one local library access check. Player and handoff bridges use the same ticket handling.
- Android builds compile Rust for ARM64, ARMv7 and x86-64. Gradle uses a portable wrapper and a pinned distribution checksum. The landing page localizes release status, reuses lyric nodes and suspends hidden effects. Library rows delegate click events.
- Verified two-account cloud isolation, duplicate command suppression, the handoff readiness gate and post-release cancellation. WebView2 returned 20 search results and persisted the chosen online track. The provider supplied no directly playable stream for the sampled track. The physical screen-off and LAN results elsewhere in this handoff predate these changes.


## 1. Newly Created Files

### Rust Core (`core/src/ytmusic/`)
- `core/src/ytmusic/mod.rs`: Exposes `YtMusicService`, `shared_service()`, synchronous JSON helpers (`search_json`, `resolve_stream_json`, `refresh_stream_json`, `album_json`, `artist_json`, `lyrics_json`), and live integration tests.
- `core/src/ytmusic/models.rs`: Data models (`YtmError`, `RecordingKind`, `SearchFilter`, `ArtistRef`, `AlbumRef`, `YtmTrack`, `YtmAlbumSummary`, `YtmArtistSummary`, `SearchResponse`, `AlbumDetail`, `ArtistDetail`, `StreamInfo`, `LyricWord`, `LyricLine`, `LyricsResult`).
- `core/src/ytmusic/client.rs`: InnerTube client descriptors (`VisionOs`, `TvHtml5`, `AndroidMusic`, `WebRemix`, `Android` `21.26.364`) with automatic `X-Goog-Visitor-Id` extraction from `sw.js_data` (cross-verified against `SimpMusic-full-arm64-v8a-release.apk`).
- `core/src/ytmusic/cipher.rs`: Player hash discovery (`iframe_api` + `api.pipepipe.dev/decoder/latest-player` fallback), `player_configs.json` & `base.js` parsing, pure-Rust `signatureCipher` ops, `api.pipepipe.dev` `n` decoding, and in-place URL patching.
- `core/src/ytmusic/stream.rs`: `adaptiveFormats` Opus/AAC ranking (`774 > 251 > 141 > 140 > 250 > 139 > 249`), multi-client fallback (`VisionOs`, `TvHtml5`, `AndroidMusic`, `WebRemix`, `Android`), HTTP `HEAD` / `Range` / `&range=` reachability verification, expiry caching, and URL refresh.
- `core/src/ytmusic/parser.rs`: Search parser (`Bản gốc` / `Live` / `Remix` / `Cover` / `Instrumental` / `Karaoke`), album/artist `browse` parsers, and 3-tier synced lyrics resolver (`SimpMusic API` → `LRCLIB` → InnerTube `MPLYt_`) with line/word LRC parser.

### Android Tooling & Native Binary
- `android/gradlew` & `android/gradlew.bat`: Wrapper scripts configuring local Gradle 8.10.2, JDK 21, and Android SDK paths.
- `android/app/src/main/jniLibs/arm64-v8a/libveluna_core.so`: Release `aarch64-linux-android` native shared library including the `&range=` fallback in `stream.rs`.

### Product Landing Website (`site/`)
- `site/CNAME`: Custom domain configuration pointing to `veluna.siloneedsleep.xyz`.
- `site/index.html`: Bilingual VI/EN product landing page for VelunaMusic preserving `#status`, `#android`, `#windows`, and `<script src="/release.js" type="module">` with zero inline `<script>`, zero inline `<style>`, zero `style=""` HTML attributes (strict `site/vercel.json` CSP compliance), announcement pill, sticky glass navbar, hero CTA with OS auto-detection + 3D dual-device mockup, 6 Bento Glass feature cards, interactive 4-preset Liquid Glass + word-timed lyrics showcase, downloads grid, 5 native `<details>` FAQ items, community section, and footer (`THIRD_PARTY.md`, GPL-3.0, `@siloneedsleep`).
- `site/style.css`: Chrome & Cobalt Blue Liquid Glass visual system (`#040812`/`#070d1d`, Cobalt Aurora, Chrome metallic gradient borders, specular hover sheen), GPU-accelerated animations with `@media (prefers-reduced-motion: reduce)`, `interpolate-size: allow-keywords` + `::details-content` + `transition-behavior: allow-discrete` FAQ accordion transitions, and preserved `.return-page`, `.video-page`, `.video-page iframe`, and `.cta` styles for `site/callback.html` and `site/watch.html`.
- `site/app.js`: Vanilla JS controller (`window.velunaSite`) handling zero-reload VI/EN switching (`localStorage["veluna-site-lang"]`), OS detection (`Android .apk` vs `Windows .exe`), `MutationObserver` release version sync from `#status`/`#android`/`#windows`, rAF-throttled `--tilt-x`/`--tilt-y` 3D tilt, `IntersectionObserver` scroll reveal and off-screen animation gating, interactive 4-preset switcher + word-timed lyrics timeline loop, mobile nav drawer, and `visibilitychange` `body.dataset.hidden` pause.

### Tests & Documentation
- `tests/theme.test.mjs`: Automated VM unit test covering the 4 Liquid Glass presets (`clear`, `frost`, `dark`, `solid`), reduced motion toggle, battery charging state, and hidden window state.
- `tests/site.test.mjs`: Automated unit test verifying `site/CNAME`, `site/index.html` CSP & semantic rules (`#faq` `<details>` without heading tags inside `<summary>`), `site/style.css` compatibility & animation tokens, and `site/app.js` VI/EN i18n, OS detection, 4 presets, and word-timed lyrics.
- `.antigravity/HANDOFF.md`, `.antigravity/API_CONTRACT.md`, `.antigravity/CHANGELOG.md`: Full architecture, Liquid Glass & motion contracts, Rust/JNI/JS signatures, and `windows/` porting checklist for Codex.

---

## 2. Modified Files

### Rust Core
- `core/Cargo.toml` & `Cargo.lock`: Added `regex`, `reqwest` (`default-features = false, features = ["json", "rustls-tls"]`), `tokio`, `url`, `urlencoding`.
- `core/src/lib.rs`: Exported `pub mod ytmusic;` and Android JNI entrypoints `Java_xyz_siloneedsleep_veluna_MainActivity_ytm*`.

### Android Java (`android/app/src/main/java/xyz/siloneedsleep/veluna/`)
- `PlaybackService.java`: Added Media3 `ResolvingDataSource.Factory`, `YTM_STREAM_CACHE`, expiry detection, and shared metadata caching in `SharedPreferences("player", 0)`.
- `AutoMix.java`: Propagated `PlaybackService.buildMediaSourceFactory(service)` into crossfade player `incoming`, added `onPlayerError` stream invalidation & retry, and preserved `updateOffload()`.
- `MainActivity.java`: Added `ytm*` JNI declarations, `@JavascriptInterface` bridge methods, background `openYouTube(id)` playback inside `PlaybackService`, `ytmusic://` handling in `readAudio()`, and artwork CDN allowlist in `shouldInterceptRequest`.

### Web UI, Icons & Attribution
- `ui/index.html`: Added `#motion-toggle`, floating mini player `#mini-bar`, `#now-badges` (`#now-source-badge`, `#now-quality-badge`), `#now-visualizer`, `#collapse-mini`, `#glass-preset-bar`, `reduced` motion option, `#dynamic-cover-bg`, `#battery-saver`, YouTube Music search panel, and updated CSP `img-src`.
- `ui/theme.css` & `ui/theme.js`: Added the 4 Liquid Glass presets (`clear`, `frost`, `dark`, `solid`), vibrancy stack (`saturate(1.5) brightness(1.04)` + 45° rim + dark scrim), `contrast-color()` + CIE XYZ badge text contrast, inline `linear()` spring view-transition styles, `56px` capsule `#mini-bar.is-pressed` blur/glow feedback, compositor-only visualizer, battery/hidden-window blur and animation downgrading, `#motion-toggle` wiring, and `velunaTheme` helpers.
- `ui/player.css`: Updated layout clearance for floating mini player, `:focus-visible` focus rings, and spring active press scaling.
- `ui/player.js`: Added `velunaMotion` (`transitionCover` with `document.startViewTransition` single-hero cleanup + focus routing, `applyCoverPalette`), `#mini-bar` touch ripple + `.is-pressed` state + controls, `#now-badges` synchronization, and fallback `<audio>` stream URL refresh.
- `ui/library.js`: Wired shared-element transitions on Home album cards, cover palette refresh on artwork load, inline YouTube Music badges/quality in library rows, and `#now-source-badge`/`#now-quality-badge` updates.
- `ui/sources.js`: Connected `velunaYtm` search/stream/refresh/album/artist/lyrics into UI badges, player quality state, and auto-loaded synced lyrics.
- `ui/lrc.js` & `ui/listening.js`: Added `hasWordTiming` and `wordProgress`, smooth centered lyric scrolling (`scrollTo`), word-by-word highlight (`--word-fill`, `.sung-past`, `.sung`) gated on valid word timestamps, and background timer pause when hidden.
- `ui/simpmusic/*.svg`: Replaced all 12 vector SVGs (`album.svg`, `favorite.svg`, `home.svg`, `library.svg`, `lyrics.svg`, `next.svg`, `pause.svg`, `play.svg`, `popular.svg`, `previous.svg`, `queue.svg`, `recent.svg`) with original clean 24×24 geometric vector paths.
- `THIRD_PARTY.md`: Documented the custom icons, SimpMusic v2.6.0 / PipePipeExtractor references, and Poppins SIL OFL 1.1 license.
- `tests/lyrics.test.mjs` & `tests/youtube.test.mjs`: Expanded coverage for word-timed lyrics progress and `velunaYtm`.

*(No files in `windows/` were modified; the `site/` landing page update did not modify `core/`, `android/`, `windows/`, or `ui/`.)*

---

## 3. Verification Results

1. **Rust Core (`cargo test -p veluna-core -- --nocapture`)**: **PASS** (verified prior to `site/` changes) — `13 passed; 0 failed; 0 ignored` (7.04s). Verified live InnerTube search (`lYBUbBu4W08`), `VISIONOS` Opus 129 kbps / 48 kHz (`expires_at=1795108488`) stream resolution returning HTTP `200 OK`, stream refresh, album/artist browse, and synced lyrics (`lrclib`, 61 lines).
2. **Android Native Shared Library (`cargo build -p veluna-core --target aarch64-linux-android --release`)**: **PASS** (verified prior to `site/` changes, 6.70s incremental) — Updated `android/app/src/main/jniLibs/arm64-v8a/libveluna_core.so`.
3. **Node Test Suite (`node --test tests/*.test.mjs`)**: **PASS** — `22` total, `21 passed; 0 failed; 1 skipped` (`live Supabase private broadcast and account isolation` requires live `VELUNA_QA_ACCOUNTS` env var; includes 2 new tests in `tests/site.test.mjs`).
4. **Android Debug APK (`.\gradlew.bat assembleDebug --no-daemon` in `android/`)**: **PASS** (verified prior to `site/` changes) — `BUILD SUCCESSFUL in 1m 47s`, output `android/app/build/outputs/apk/debug/app-debug.apk` (`19,833,646` bytes).
5. **Cleanup & Comment/CSP Scan**: Verified `%TEMP%\simpmusic_apk_inspect` removed cleanly (`Temp removed: True`) and zero explanatory comments, placeholders, or inline `style=""` HTML attributes across `site/CNAME`, `site/index.html`, `site/style.css`, `site/app.js`, and `tests/site.test.mjs`.
