# VelunaMusic

VelunaMusic is a music player in development for Android and Windows, with a shared Rust core and a customizable blue glass interface. The first public release is planned after accounts, device handoff, AI DJ and the rest of the [product specification](.codex/PRODUCT_SPEC.md) have been implemented and verified.

[VelunaMusic website](https://veluna.siloneedsleep.xyz) · [Bản đặc tả tiếng Việt và tiếng Anh](.codex/PRODUCT_SPEC.md)

## Development

On Windows with the Rust MSVC toolchain, WebView2 and Visual Studio C++ build tools installed:

```powershell
cargo test --locked -p veluna-core
cargo run --locked -p velunamusic --features custom-protocol
node --test tests/*.test.mjs
```

The Android app uses Media3 for background playback and the system document picker for local tracks. The CI workflow builds the Rust shared libraries for each Android ABI before Gradle packages the app. It also compiles the Windows player. Builds on the development branch do not publish an installer or create a GitHub Release.

## License

VelunaMusic is licensed under [GPL-3.0](LICENSE). The [third-party notices](THIRD_PARTY.md) identify the SimpMusic adaptations and the Poppins font license.
