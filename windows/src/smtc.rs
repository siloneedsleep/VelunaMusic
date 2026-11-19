use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmtcPayload {
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub album: String,
    #[serde(default)]
    pub artwork: Option<String>,
    pub playing: bool,
}

#[derive(Default)]
pub struct SmtcState {
    #[cfg(target_os = "windows")]
    inner: Mutex<Option<SmtcController>>,
}

#[cfg(target_os = "windows")]
struct SmtcController {
    controls: windows::Media::SystemMediaTransportControls,
    last_artwork: Option<String>,
}

#[cfg(target_os = "windows")]
fn button_to_action(
    button: windows::Media::SystemMediaTransportControlsButton,
) -> Option<&'static str> {
    use windows::Media::SystemMediaTransportControlsButton as Btn;
    match button {
        Btn::Play => Some("play"),
        Btn::Pause => Some("pause"),
        Btn::Next => Some("next"),
        Btn::Previous => Some("previous"),
        Btn::Stop => Some("stop"),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn decode_data_url_bytes(raw: &str) -> Option<Vec<u8>> {
    let rest = raw.strip_prefix("data:image/")?;
    let (_, encoded) = rest.split_once(";base64,")?;
    STANDARD.decode(encoded.trim()).ok()
}

#[cfg(target_os = "windows")]
fn build_thumbnail(
    artwork: &str,
) -> windows::core::Result<windows::Storage::Streams::RandomAccessStreamReference> {
    use windows::core::HSTRING;
    use windows::Foundation::Uri;
    use windows::Storage::StorageFile;
    use windows::Storage::Streams::{
        DataWriter, InMemoryRandomAccessStream, RandomAccessStreamReference,
    };

    let trimmed = artwork.trim();
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        let uri = Uri::CreateUri(&HSTRING::from(trimmed))?;
        return RandomAccessStreamReference::CreateFromUri(&uri);
    }
    if let Some(bytes) = decode_data_url_bytes(trimmed) {
        let stream = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(&bytes)?;
        let _ = writer.StoreAsync()?.join()?;
        let _ = writer.FlushAsync()?.join()?;
        let _ = writer.DetachStream()?;
        stream.Seek(0)?;
        return RandomAccessStreamReference::CreateFromStream(&stream);
    }
    let path = Path::new(trimmed);
    let abs = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(abs.to_string_lossy().as_ref()))?
        .join()?;
    RandomAccessStreamReference::CreateFromFile(&file)
}

#[cfg(target_os = "windows")]
impl SmtcState {
    pub fn attach(&self, app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
        use windows::core::factory;
        use windows::Foundation::TypedEventHandler;
        use windows::Media::{
            MediaPlaybackStatus, SystemMediaTransportControls,
            SystemMediaTransportControlsButtonPressedEventArgs,
        };
        use windows::Win32::Foundation::HWND;
        use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

        let raw_hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd = HWND(raw_hwnd.0);
        let interop: ISystemMediaTransportControlsInterop =
            factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()
                .map_err(|e| e.to_string())?;
        let controls: SystemMediaTransportControls =
            unsafe { interop.GetForWindow(hwnd) }.map_err(|e| e.to_string())?;

        controls.SetIsEnabled(true).map_err(|e| e.to_string())?;
        controls.SetIsPlayEnabled(true).map_err(|e| e.to_string())?;
        controls
            .SetIsPauseEnabled(true)
            .map_err(|e| e.to_string())?;
        controls.SetIsNextEnabled(true).map_err(|e| e.to_string())?;
        controls
            .SetIsPreviousEnabled(true)
            .map_err(|e| e.to_string())?;
        controls.SetIsStopEnabled(true).map_err(|e| e.to_string())?;
        controls
            .SetPlaybackStatus(MediaPlaybackStatus::Closed)
            .map_err(|e| e.to_string())?;

        let app_handle = app.clone();
        let handler = TypedEventHandler::<
            SystemMediaTransportControls,
            SystemMediaTransportControlsButtonPressedEventArgs,
        >::new(move |_sender, args| {
            if let Some(event_args) = args.as_ref() {
                if let Ok(button) = event_args.Button() {
                    if let Some(action) = button_to_action(button) {
                        let _ = app_handle.emit("veluna-smtc-command", action);
                        if let Some(win) = app_handle.get_webview_window("main") {
                            let _ = win.eval(format!("window.onVelunaSmtcCommand?.({action:?})"));
                        }
                    }
                }
            }
            Ok(())
        });
        controls
            .ButtonPressed(&handler)
            .map_err(|e| e.to_string())?;

        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "SMTC state unavailable".to_string())?;
        *guard = Some(SmtcController {
            controls,
            last_artwork: None,
        });
        Ok(())
    }

    pub fn update(&self, payload: &SmtcPayload) -> Result<(), String> {
        use windows::core::HSTRING;
        use windows::Media::{MediaPlaybackStatus, MediaPlaybackType};

        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "SMTC state unavailable".to_string())?;
        let Some(ctrl) = guard.as_mut() else {
            return Ok(());
        };

        let status = if payload.title.trim().is_empty() {
            MediaPlaybackStatus::Stopped
        } else if payload.playing {
            MediaPlaybackStatus::Playing
        } else {
            MediaPlaybackStatus::Paused
        };
        ctrl.controls
            .SetPlaybackStatus(status)
            .map_err(|e| e.to_string())?;

        let updater = ctrl
            .controls
            .DisplayUpdater()
            .map_err(|e| e.to_string())?;
        if payload.title.trim().is_empty() {
            let _ = updater.ClearAll();
            let _ = updater.Update();
            ctrl.last_artwork = None;
            return Ok(());
        }

        updater
            .SetType(MediaPlaybackType::Music)
            .map_err(|e| e.to_string())?;
        let music = updater.MusicProperties().map_err(|e| e.to_string())?;
        music
            .SetTitle(&HSTRING::from(payload.title.trim()))
            .map_err(|e| e.to_string())?;
        music
            .SetArtist(&HSTRING::from(payload.artist.trim()))
            .map_err(|e| e.to_string())?;
        music
            .SetAlbumTitle(&HSTRING::from(payload.album.trim()))
            .map_err(|e| e.to_string())?;

        let next_art = payload
            .artwork
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        if next_art != ctrl.last_artwork {
            if let Some(ref art) = next_art {
                if let Ok(thumb) = build_thumbnail(art) {
                    let _ = updater.SetThumbnail(&thumb);
                }
            } else {
                let _ = updater.SetThumbnail(None);
            }
            ctrl.last_artwork = next_art;
        }

        updater.Update().map_err(|e| e.to_string())
    }
}

#[cfg(not(target_os = "windows"))]
impl SmtcState {
    pub fn attach(&self, _app: &AppHandle, _window: &WebviewWindow) -> Result<(), String> {
        Ok(())
    }

    pub fn update(&self, _payload: &SmtcPayload) -> Result<(), String> {
        Ok(())
    }
}

#[tauri::command]
pub fn smtc_update(state: tauri::State<SmtcState>, payload: SmtcPayload) -> Result<(), String> {
    state.update(&payload)
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn decodes_base64_data_url_and_maps_buttons() {
        let bytes = decode_data_url_bytes("data:image/png;base64,aGVsbG8=").expect("decode");
        assert_eq!(bytes, b"hello");
        assert!(decode_data_url_bytes("https://example.com/a.jpg").is_none());

        use windows::Media::SystemMediaTransportControlsButton as Btn;
        assert_eq!(button_to_action(Btn::Play), Some("play"));
        assert_eq!(button_to_action(Btn::Pause), Some("pause"));
        assert_eq!(button_to_action(Btn::Next), Some("next"));
        assert_eq!(button_to_action(Btn::Previous), Some("previous"));
        assert_eq!(button_to_action(Btn::Stop), Some("stop"));
    }
}
