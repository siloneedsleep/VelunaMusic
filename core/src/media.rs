use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::fs::File;
use symphonia::core::{
    io::MediaSourceStream,
    meta::{Limit, MetadataOptions, MetadataRevision, StandardTagKey, StandardVisualKey, Value},
    probe::Hint,
};

const COVER_LIMIT: usize = 2 * 1024 * 1024;

#[derive(Default, Serialize)]
pub struct MediaTags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub disc: Option<u32>,
    pub track: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
}

impl MediaTags {
    fn merge(&mut self, revision: &MetadataRevision, artwork: bool) {
        for tag in revision.tags() {
            let Some(key) = tag.std_key else { continue };
            if matches!(
                key,
                StandardTagKey::DiscNumber | StandardTagKey::TrackNumber
            ) {
                let number = match &tag.value {
                    Value::String(text) => text
                        .split('/')
                        .next()
                        .and_then(|n| n.trim().parse::<u32>().ok()),
                    Value::UnsignedInt(n) => u32::try_from(*n).ok(),
                    Value::SignedInt(n) => u32::try_from(*n).ok(),
                    _ => None,
                }
                .filter(|n| *n > 0);
                let field = if key == StandardTagKey::DiscNumber {
                    &mut self.disc
                } else {
                    &mut self.track
                };
                if field.is_none() {
                    *field = number;
                }
                continue;
            }
            let field = match key {
                StandardTagKey::TrackTitle => &mut self.title,
                StandardTagKey::Artist => &mut self.artist,
                StandardTagKey::Album => &mut self.album,
                StandardTagKey::AlbumArtist => &mut self.album_artist,
                _ => continue,
            };
            if let Value::String(value) = &tag.value {
                let text = value.trim();
                if field.is_none() && !text.is_empty() {
                    *field = Some(text.chars().take(320).collect());
                }
            }
        }
        if !artwork || self.cover.is_some() {
            return;
        }
        let visual = revision
            .visuals()
            .iter()
            .filter_map(|picture| {
                let data = &picture.data;
                if data.len() > COVER_LIMIT {
                    return None;
                }
                let mime = if data.starts_with(&[0xff, 0xd8, 0xff]) {
                    "image/jpeg"
                } else if data.starts_with(b"\x89PNG\r\n\x1a\n") {
                    "image/png"
                } else if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP") {
                    "image/webp"
                } else {
                    return None;
                };
                Some((picture, mime))
            })
            .max_by_key(|(picture, _)| picture.usage == Some(StandardVisualKey::FrontCover));
        if let Some((picture, mime)) = visual {
            self.cover = Some(format!(
                "data:{mime};base64,{}",
                STANDARD.encode(&picture.data)
            ));
        }
    }
}

/// Read container tags without opening an audio decoder.
pub fn read(file: File, artwork: bool) -> Result<MediaTags, String> {
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let limits = MetadataOptions {
        limit_metadata_bytes: Limit::Maximum(256 * 1024),
        limit_visual_bytes: Limit::Maximum(if artwork { COVER_LIMIT } else { 0 }),
    };
    let mut media = symphonia::default::get_probe()
        .format(&Hint::new(), stream, &Default::default(), &limits)
        .map_err(|e| e.to_string())?;
    let mut result = MediaTags::default();
    if let Some(mut metadata) = media.metadata.get() {
        if let Some(revision) = metadata.skip_to_latest() {
            result.merge(revision, artwork);
        }
    }
    if let Some(revision) = media.format.metadata().skip_to_latest() {
        result.merge(revision, artwork);
    }
    Ok(result)
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_xyz_siloneedsleep_veluna_MainActivity_readMediaTags(
    env: jni::JNIEnv,
    _: jni::objects::JClass,
    fd: jni::sys::jint,
    artwork: jni::sys::jboolean,
) -> jni::sys::jstring {
    use std::os::fd::FromRawFd;
    if fd < 0 {
        return std::ptr::null_mut();
    }
    // The caller passes ownership with ParcelFileDescriptor.detachFd().
    let file = unsafe { File::from_raw_fd(fd) };
    read(file, artwork != 0)
        .ok()
        .and_then(|tags| serde_json::to_string(&tags).ok())
        .and_then(|s| env.new_string(s).ok())
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(id: &[u8], bytes: &[u8]) -> Vec<u8> {
        [id, &(bytes.len() as u32).to_be_bytes(), &[0, 0], bytes].concat()
    }

    #[test]
    fn embedded_id3_text_and_front_cover_are_read_without_decoding_audio() {
        let mut tags = frame(b"TIT2", b"\x03Night Drive");
        tags.extend(frame(b"TPE1", b"\x03Veluna Band"));
        tags.extend(frame(b"TALB", b"\x03Blue Hours"));
        tags.extend(frame(b"TRCK", b"\x037/11"));
        tags.extend(frame(
            b"APIC",
            b"\x00image/png\x00\x03\x00\x89PNG\r\n\x1a\nfixture",
        ));
        let size = tags.len();
        let mut file = b"ID3\x03\x00\x00".to_vec();
        file.extend([
            ((size >> 21) & 127) as u8,
            ((size >> 14) & 127) as u8,
            ((size >> 7) & 127) as u8,
            (size & 127) as u8,
        ]);
        file.extend(tags);
        file.extend(b"RIFF\x26\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x40\x1f\x00\x00\x80\x3e\x00\x00\x02\x00\x10\x00data\x02\x00\x00\x00\x00\x00");
        let path = std::env::temp_dir().join(format!("veluna-tags-{}.wav", std::process::id()));
        std::fs::write(&path, file).unwrap();
        let with = read(File::open(&path).unwrap(), true).unwrap();
        let without = read(File::open(&path).unwrap(), false).unwrap();
        std::fs::remove_file(path).unwrap();
        assert_eq!(with.title.as_deref(), Some("Night Drive"));
        assert_eq!(with.artist.as_deref(), Some("Veluna Band"));
        assert_eq!(with.album.as_deref(), Some("Blue Hours"));
        assert!(with.cover.unwrap().starts_with("data:image/png;base64,"));
        assert!(without.cover.is_none());
        assert_eq!(with.track, Some(7));
        assert_eq!(without.title, with.title);
    }
}
