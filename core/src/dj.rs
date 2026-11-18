use serde::Serialize;
use std::fs::File;
use symphonia::core::{
    audio::SampleBuffer,
    codecs::DecoderOptions,
    formats::{FormatOptions, FormatReader, SeekMode, SeekTo},
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
    units::Time,
};

#[derive(Clone, Debug, Serialize)]
pub struct Section {
    pub bpm: Option<u16>,
    pub confidence: f32,
    pub rms: f32,
}
#[derive(Debug, Serialize)]
pub struct Analysis {
    pub intro: Section,
    pub outro: Option<Section>,
    pub duration: Option<f64>,
}

fn describe(envelope: &[f32]) -> Section {
    let rms = (envelope.iter().map(|v| v * v).sum::<f32>() / envelope.len().max(1) as f32).sqrt();
    let onsets: Vec<f32> = envelope
        .windows(2)
        .map(|e| (e[1] - e[0]).max(0.0))
        .collect();
    let mut best = (0, 0.0f32);
    // 20 ms windows. Report a pulse only when the onset envelope repeats.
    if onsets.len() >= 200 {
        for lag in 16..=50 {
            let (mut dot, mut a, mut b) = (0.0, 0.0, 0.0);
            for (x, y) in onsets.iter().skip(lag).zip(onsets.iter()) {
                dot += x * y;
                a += x * x;
                b += y * y;
            }
            let score = dot / (a * b).sqrt().max(1e-8);
            if score > best.1 {
                best = (lag, score);
            }
        }
    }
    Section {
        bpm: (best.1 >= 0.38).then(|| (3000.0 / best.0 as f32).round() as u16),
        confidence: best.1.clamp(0.0, 1.0),
        rms,
    }
}

fn section(
    reader: &mut dyn FormatReader,
    decoder: &mut dyn symphonia::core::codecs::Decoder,
    id: u32,
) -> Result<Section, String> {
    let mut envelope = Vec::with_capacity(600);
    let (mut sum, mut count) = (0.0f32, 0usize);
    let mut failures = 0;
    while envelope.len() < 600 {
        let packet = match reader.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(e) => return Err(e.to_string()),
        };
        if packet.track_id() != id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(audio) => audio,
            Err(symphonia::core::errors::Error::DecodeError(_)) if failures < 8 => {
                failures += 1;
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        let spec = *decoded.spec();
        let channels = spec.channels.count();
        if channels == 0 || spec.rate == 0 {
            return Err("Invalid audio stream".into());
        }
        let mut pcm = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        pcm.copy_interleaved_ref(decoded);
        for frame in pcm.samples().chunks_exact(channels) {
            sum += frame.iter().map(|v| v * v).sum::<f32>() / channels as f32;
            count += 1;
            if count >= (spec.rate / 50).max(1) as usize {
                envelope.push((sum / count as f32).sqrt());
                count = 0;
                sum = 0.0;
                if envelope.len() == 600 {
                    break;
                }
            }
        }
    }
    if envelope.is_empty() {
        return Err("No decodable audio".into());
    }
    Ok(describe(&envelope))
}

pub fn analyze(file: File) -> Result<Analysis, String> {
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let probed = symphonia::default::get_probe()
        .format(
            &Hint::new(),
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| e.to_string())?;
    let mut reader = probed.format;
    let track = reader.default_track().ok_or("No audio track")?;
    let id = track.id;
    let params = track.codec_params.clone();
    let duration = params.time_base.zip(params.n_frames).map(|(base, n)| {
        let t = base.calc_time(n);
        t.seconds as f64 + t.frac
    });
    let mut decoder = symphonia::default::get_codecs()
        .make(&params, &DecoderOptions::default())
        .map_err(|e| e.to_string())?;
    let intro = section(reader.as_mut(), decoder.as_mut(), id)?;
    let mut outro = None;
    if let Some(d) = duration {
        if d <= 12.0 {
            outro = Some(intro.clone());
        } else if reader
            .seek(
                SeekMode::Accurate,
                SeekTo::Time {
                    time: Time::from(d - 12.0),
                    track_id: Some(id),
                },
            )
            .is_ok()
        {
            decoder.reset();
            outro = section(reader.as_mut(), decoder.as_mut(), id).ok();
        }
    }
    Ok(Analysis {
        intro,
        outro,
        duration,
    })
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_xyz_siloneedsleep_veluna_MainActivity_analyzeAudio(
    env: jni::JNIEnv,
    _: jni::objects::JClass,
    fd: jni::sys::jint,
) -> jni::sys::jstring {
    use std::os::fd::FromRawFd;
    if fd < 0 {
        return std::ptr::null_mut();
    }
    // The Android bridge transfers ownership using ParcelFileDescriptor.detachFd.
    let output = analyze(unsafe { File::from_raw_fd(fd) })
        .ok()
        .and_then(|a| serde_json::to_string(&a).ok());
    output
        .and_then(|s| env.new_string(s).ok())
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tempo_requires_repeating_onsets() {
        assert!(describe(&[0.0; 500]).bpm.is_none());
        let envelope: Vec<_> = (0..600)
            .map(|i| if i % 25 == 0 { 0.9 } else { 0.04 })
            .collect();
        assert_eq!(describe(&envelope).bpm, Some(120));
    }
}
