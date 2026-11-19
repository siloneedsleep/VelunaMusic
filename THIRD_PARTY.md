# Upstream components

VelunaMusic is distributed under the GNU General Public License, version 3. The license text is in [LICENSE](LICENSE).

## SimpMusic

The following adaptations use [SimpMusic v2.6.0 by maxrave-dev and contributors](https://github.com/maxrave-dev/SimpMusic/tree/140673ab2f2b83d5a2264d3a5f51f1dce3ab6b05). VelunaMusic contributors converted the resources and ported the lyrics behavior on 19 November 2026.

- The playback glyphs in `ui/simpmusic` come from `androidApp/src/main/res/drawable`. The play, pause, previous and next glyphs use the original 24-unit vector paths.
- The Material Design icon artwork is credited to Google and is licensed under [Apache License 2.0](ui/simpmusic/Material-Apache-2.0.txt). The remaining library and lyrics glyphs come from `composeApp/src/commonMain/composeResources/drawable`. VelunaMusic packages the vector paths as SVG masks to inherit the active theme.
- `ui/lrc.js` adapts the line and word timestamp rules in `composeApp/src/commonMain/kotlin/com/maxrave/simpmusic/utils/UserLrc.kt`. VelunaMusic also accepts plain text and older colon-delimited fractions. The timing adjustment in `ui/listening.js` uses the 100 ms step from `ui/component/LyricsOffsetControl.kt` and stores adjustments per local track.
- The side navigation follows SimpMusic’s desktop library layout. Its WebView implementation, file metadata bridge, history storage, queue controls and integration with Veluna playlists were written for VelunaMusic.

## Fonts

Poppins Regular and Bold were bundled from SimpMusic’s Compose resources. The bundled fonts credit Vntype.Com and FontZin.Com for Vietnamese localization. The font authors license Poppins under the SIL Open Font License 1.1. The copyright notice and full font license ship in [Poppins-OFL.txt](ui/simpmusic/Poppins-OFL.txt).

The license texts are also readable in the application settings.
