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
    pub cue_in_ms: u64,
    pub codec: Option<&'static str>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub channels: Option<usize>,
    pub average_file_kbps: Option<u32>,
}

pub fn equal_power_gains(progress: f32) -> (f32, f32) {
    let p = progress.clamp(0.0, 1.0);
    let angle = std::f32::consts::FRAC_PI_2 * p;
    (angle.cos(), angle.sin())
}

pub fn detect_cue_in_ms(envelope: &[f32], rms: f32) -> u64 {
    if envelope.is_empty() || rms <= 1e-4 {
        return 0;
    }
    let threshold = (rms * 0.15).max(0.015);
    let idx = envelope.iter().position(|&v| v >= threshold).unwrap_or(0);
    ((idx as u64) * 20).min(4000)
}

fn third_duration_cap_ms(duration: Option<f64>, fallback: u64) -> u64 {
    duration
        .filter(|d| d.is_finite() && *d > 0.0)
        .map(|d| (d * 1000.0 / 3.0) as u64)
        .unwrap_or(fallback)
}

pub fn recommend_crossfade_ms(
    outro: Option<&Section>,
    intro: &Section,
    duration_a: Option<f64>,
    duration_b: Option<f64>,
) -> u64 {
    let cap = third_duration_cap_ms(duration_a, 4000)
        .min(third_duration_cap_ms(duration_b, 4000))
        .min(8000);
    let bpm = outro
        .and_then(|s| s.bpm)
        .zip(intro.bpm)
        .map(|(a, b)| a.min(b));
    let target = match bpm {
        Some(b) if b > 0 => ((480_000.0 / f64::from(b)).round() as u64).clamp(3000, 8000),
        _ => 4000,
    };
    target.min(cap)
}

pub fn plan_crossfade_ms(
    style: &str,
    fixed_seconds: u64,
    outro: Option<&Section>,
    intro: &Section,
    duration_a: Option<f64>,
    duration_b: Option<f64>,
) -> u64 {
    if style == "album" {
        return 0;
    }
    if fixed_seconds > 0 {
        let cap = third_duration_cap_ms(duration_a, 30_000)
            .min(third_duration_cap_ms(duration_b, 30_000));
        return (fixed_seconds.min(30) * 1000).min(cap);
    }
    let base = recommend_crossfade_ms(outro, intro, duration_a, duration_b);
    if style == "party" {
        let cap = duration_a
            .zip(duration_b)
            .map(|(da, db)| ((da.min(db) * 1000.0 / 3.0) as u64).min(8000))
            .unwrap_or(8000);
        ((base as f64 * 1.25).round() as u64).min(cap)
    } else {
        base
    }
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
) -> Result<(Section, Vec<f32>), String> {
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
    let described = describe(&envelope);
    Ok((described, envelope))
}

pub fn analyze(file: File) -> Result<Analysis, String> {
    let bytes = file
        .metadata()
        .ok()
        .map(|m| m.len())
        .filter(|size| *size > 0);
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
    let (intro, intro_env) = section(reader.as_mut(), decoder.as_mut(), id)?;
    let cue_in_ms = detect_cue_in_ms(&intro_env, intro.rms);
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
            outro = section(reader.as_mut(), decoder.as_mut(), id)
                .ok()
                .map(|(s, _)| s);
        }
    }
    Ok(Analysis {
        intro,
        outro,
        duration,
        cue_in_ms,
        codec: symphonia::default::get_codecs()
            .get_codec(params.codec)
            .map(|c| c.short_name),
        sample_rate: params.sample_rate,
        bit_depth: params.bits_per_sample,
        channels: params.channels.map(|c| c.count()),
        average_file_kbps: bytes
            .zip(duration)
            .filter(|(_, d)| *d > 0.0)
            .map(|(size, d)| (size as f64 * 8.0 / d / 1000.0).round() as u32),
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
    fn equal_power_curve_and_cue_in_detection() {
        let (out0, in0) = equal_power_gains(0.0);
        assert!((out0 - 1.0).abs() < 1e-5);
        assert!(in0.abs() < 1e-5);

        let (out_mid, in_mid) = equal_power_gains(0.5);
        assert!((out_mid * out_mid + in_mid * in_mid - 1.0).abs() < 1e-5);
        assert!((out_mid - std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-4);
        assert!((in_mid - std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-4);

        let (out1, in1) = equal_power_gains(1.0);
        assert!(out1.abs() < 1e-5);
        assert!((in1 - 1.0).abs() < 1e-5);

        let mut env = vec![0.001f32; 25];
        env.extend_from_slice(&[0.5f32; 100]);
        assert_eq!(detect_cue_in_ms(&env, 0.4), 500);

        let sec = Section {
            bpm: Some(120),
            confidence: 0.9,
            rms: 0.3,
        };
        assert_eq!(
            recommend_crossfade_ms(Some(&sec), &sec, Some(180.0), Some(180.0)),
            4000
        );
    }

    #[test]
    fn tempo_requires_repeating_onsets() {
        assert!(describe(&[0.0; 500]).bpm.is_none());
        let envelope: Vec<_> = (0..600)
            .map(|i| if i % 25 == 0 { 0.9 } else { 0.04 })
            .collect();
        assert_eq!(describe(&envelope).bpm, Some(120));
    }
    #[test]
    fn decodes_both_ends_of_a_real_wave_stream() {
        use std::io::Write;
        let rate = 8000_u32;
        let frames = rate * 32;
        let path = std::env::temp_dir().join(format!(
            "veluna-dj-{}-{}.wav",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut out = std::io::BufWriter::new(File::create(&path).unwrap());
        let size = frames * 2;
        out.write_all(b"RIFF").unwrap();
        out.write_all(&(size + 36).to_le_bytes()).unwrap();
        out.write_all(b"WAVEfmt ").unwrap();
        out.write_all(&16u32.to_le_bytes()).unwrap();
        for n in [1_u16, 1] {
            out.write_all(&n.to_le_bytes()).unwrap();
        }
        for n in [rate, rate * 2] {
            out.write_all(&n.to_le_bytes()).unwrap();
        }
        for n in [2_u16, 16] {
            out.write_all(&n.to_le_bytes()).unwrap();
        }
        out.write_all(b"data").unwrap();
        out.write_all(&size.to_le_bytes()).unwrap();
        for frame in 0..frames {
            let period = if frame < rate * 16 { 4000 } else { 4800 };
            let pulse = if frame % period < 160 { 9000_i16 } else { 0 };
            out.write_all(&pulse.to_le_bytes()).unwrap();
        }
        drop(out);
        let features = analyze(File::open(&path).unwrap());
        std::fs::remove_file(&path).unwrap();
        let features = features.unwrap();
        assert_eq!(features.intro.bpm, Some(120));
        assert_eq!(features.outro.unwrap().bpm, Some(100));
        assert!((features.duration.unwrap() - 32.0).abs() < 0.01);
        assert_eq!(features.sample_rate, Some(8000));
        assert_eq!(features.channels, Some(1));
        assert_eq!(features.average_file_kbps, Some(128));
    }
}
