# Upstream components

VelunaMusic is distributed under the GNU General Public License, version 3. The license text is in [LICENSE](LICENSE).

## Custom Vector Icons (`ui/simpmusic/*.svg`)

- All twelve interface icons in `ui/simpmusic/` (`album.svg`, `favorite.svg`, `home.svg`, `library.svg`, `lyrics.svg`, `next.svg`, `pause.svg`, `play.svg`, `popular.svg`, `previous.svg`, `queue.svg`, `recent.svg`) were authored cleanly as original 24×24 single-color CSS mask vector paths for VelunaMusic, replacing imported drawable icon paths.

## SimpMusic & PipePipeExtractor References

The following adaptations and technical references use [SimpMusic v2.6.0 by maxrave-dev and contributors](https://github.com/maxrave-dev/SimpMusic/tree/140673ab2f2b83d5a2264d3a5f51f1dce3ab6b05) (`core` submodule at `8413a257cbe45d102a9f101f2760e35b549e4d9e`, licensed under [GPL-3.0](ui/simpmusic/GPL-3.0.txt)):

- `core/src/ytmusic/` adapts InnerTube client profiles (`WEB_REMIX`, `ANDROID_MUSIC`, `VISIONOS`, `ANDROID`), visitor data extraction (`/sw.js_data`), `signatureCipher` / `n`-parameter deobfuscation references (with [PipePipeExtractor](https://github.com/maxrave-dev/PipePipeExtractor) decoder conventions and `maxrave-dev/simpmusic-files` player config registry), search/album/artist parsing, and the multi-tier synced lyrics fallback architecture (`api-lyrics.simpmusic.org`, `lrclib.net`, InnerTube `MPLYt_`).
- `ui/lrc.js` adapts the line and word timestamp rules in `composeApp/src/commonMain/kotlin/com/maxrave/simpmusic/utils/UserLrc.kt`. VelunaMusic also accepts plain text and older colon-delimited fractions. The timing adjustment in `ui/listening.js` uses the 100 ms step from `ui/component/LyricsOffsetControl.kt` and stores adjustments per local track.
- The side navigation follows SimpMusic's desktop library layout. Its WebView implementation, Liquid Glass styling system, Media3 `ResolvingDataSource` integration, file metadata bridge, history storage, queue controls, and integration with Veluna playlists were written for VelunaMusic.

## Fonts & Third-Party License Texts

- Poppins Regular and Bold were originally bundled from SimpMusic's Compose resources. The bundled fonts credit Vntype.Com and FontZin.Com for Vietnamese localization and are licensed under the SIL Open Font License 1.1 ([Poppins-OFL.txt](ui/simpmusic/Poppins-OFL.txt)).
- The Apache License 2.0 text ([Material-Apache-2.0.txt](ui/simpmusic/Material-Apache-2.0.txt)) and GPL-3.0 text ([GPL-3.0.txt](ui/simpmusic/GPL-3.0.txt)) remain shipped and viewable in the application settings dialog.
