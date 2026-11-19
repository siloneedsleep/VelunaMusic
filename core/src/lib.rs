use semver::Version;
pub mod dj;
pub mod media;
pub mod ytmusic;

/// Only offer stable releases newer than the installed build.
pub fn newer_release(installed: &str, tag: &str) -> bool {
    let Some(candidate) = tag.strip_prefix('v').and_then(|s| Version::parse(s).ok()) else {
        return false;
    };
    Version::parse(installed).is_ok_and(|current| candidate.pre.is_empty() && candidate > current)
}

#[cfg(target_os = "android")]
#[allow(non_snake_case)]
#[no_mangle]
pub extern "system" fn Java_xyz_siloneedsleep_veluna_MainActivity_newerRelease(
    mut env: jni::JNIEnv,
    _: jni::objects::JClass,
    installed: jni::objects::JString,
    tag: jni::objects::JString,
) -> jni::sys::jboolean {
    let Ok(current) = env.get_string(&installed).map(String::from) else {
        return 0;
    };
    let Ok(next) = env.get_string(&tag).map(String::from) else {
        return 0;
    };
    newer_release(&current, &next) as u8
}

#[cfg(target_os = "android")]
fn jni_read_opt_string(env: &mut jni::JNIEnv, s: &jni::objects::JString) -> Option<String> {
    if s.is_null() {
        return None;
    }
    env.get_string(s)
        .ok()
        .map(String::from)
        .filter(|v| !v.trim().is_empty())
}

#[cfg(target_os = "android")]
fn jni_json_return(env: &mut jni::JNIEnv, result: Result<String, String>) -> jni::sys::jstring {
    let payload = match result {
        Ok(json) => json,
        Err(err) => serde_json::json!({ "error": err }).to_string(),
    };
    env.new_string(payload)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[cfg(target_os = "android")]
#[allow(non_snake_case)]
#[no_mangle]
pub extern "system" fn Java_xyz_siloneedsleep_veluna_MainActivity_ytmSearch(
    mut env: jni::JNIEnv,
    _: jni::objects::JClass,
    query: jni::objects::JString,
    filter: jni::objects::JString,
) -> jni::sys::jstring {
    let Some(q) = jni_read_opt_string(&mut env, &query) else {
        return jni_json_return(&mut env, Err("Missing query".into()));
    };
    let f = jni_read_opt_string(&mut env, &filter);
    let res = ytmusic::search_json(&q, f.as_deref());
    jni_json_return(&mut env, res)
}

#[cfg(target_os = "android")]
#[allow(non_snake_case)]
#[no_mangle]
pub extern "system" fn Java_xyz_siloneedsleep_veluna_MainActivity_ytmResolveStream(
    mut env: jni::JNIEnv,
    _: jni::objects::JClass,
    video_id: jni::objects::JString,
    force_refresh: jni::sys::jboolean,
) -> jni::sys::jstring {
    let Some(vid) = jni_read_opt_string(&mut env, &video_id) else {
        return jni_json_return(&mut env, Err("Missing videoId".into()));
    };
    let res = ytmusic::resolve_stream_json(&vid, force_refresh != 0);
    jni_json_return(&mut env, res)
}

#[cfg(target_os = "android")]
#[allow(non_snake_case)]
#[no_mangle]
pub extern "system" fn Java_xyz_siloneedsleep_veluna_MainActivity_ytmRefreshStream(
    mut env: jni::JNIEnv,
    _: jni::objects::JClass,
    video_id: jni::objects::JString,
) -> jni::sys::jstring {
    let Some(vid) = jni_read_opt_string(&mut env, &video_id) else {
        return jni_json_return(&mut env, Err("Missing videoId".into()));
    };
    let res = ytmusic::refresh_stream_json(&vid);
    jni_json_return(&mut env, res)
}

#[cfg(target_os = "android")]
#[allow(non_snake_case)]
#[no_mangle]
pub extern "system" fn Java_xyz_siloneedsleep_veluna_MainActivity_ytmAlbum(
    mut env: jni::JNIEnv,
    _: jni::objects::JClass,
    browse_id: jni::objects::JString,
) -> jni::sys::jstring {
    let Some(bid) = jni_read_opt_string(&mut env, &browse_id) else {
        return jni_json_return(&mut env, Err("Missing browseId".into()));
    };
    let res = ytmusic::album_json(&bid);
    jni_json_return(&mut env, res)
}

#[cfg(target_os = "android")]
#[allow(non_snake_case)]
#[no_mangle]
pub extern "system" fn Java_xyz_siloneedsleep_veluna_MainActivity_ytmArtist(
    mut env: jni::JNIEnv,
    _: jni::objects::JClass,
    browse_id: jni::objects::JString,
) -> jni::sys::jstring {
    let Some(bid) = jni_read_opt_string(&mut env, &browse_id) else {
        return jni_json_return(&mut env, Err("Missing browseId".into()));
    };
    let res = ytmusic::artist_json(&bid);
    jni_json_return(&mut env, res)
}

#[cfg(target_os = "android")]
#[allow(non_snake_case)]
#[no_mangle]
pub extern "system" fn Java_xyz_siloneedsleep_veluna_MainActivity_ytmHome(
    mut env: jni::JNIEnv,
    _: jni::objects::JClass,
    params: jni::objects::JString,
    continuation: jni::objects::JString,
) -> jni::sys::jstring {
    let p = jni_read_opt_string(&mut env, &params);
    let c = jni_read_opt_string(&mut env, &continuation);
    let res = ytmusic::home_json(p.as_deref(), c.as_deref());
    jni_json_return(&mut env, res)
}

#[cfg(target_os = "android")]
#[allow(non_snake_case)]
#[no_mangle]
pub extern "system" fn Java_xyz_siloneedsleep_veluna_MainActivity_ytmLyrics(
    mut env: jni::JNIEnv,
    _: jni::objects::JClass,
    video_id: jni::objects::JString,
    title: jni::objects::JString,
    artist: jni::objects::JString,
    duration_sec: jni::sys::jlong,
) -> jni::sys::jstring {
    let Some(vid) = jni_read_opt_string(&mut env, &video_id) else {
        return jni_json_return(&mut env, Err("Missing videoId".into()));
    };
    let t = jni_read_opt_string(&mut env, &title);
    let a = jni_read_opt_string(&mut env, &artist);
    let d = if duration_sec > 0 {
        Some(duration_sec as u64)
    } else {
        None
    };
    let res = ytmusic::lyrics_json(&vid, t.as_deref(), a.as_deref(), d);
    jni_json_return(&mut env, res)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn release_order_and_channel() {
        assert!(newer_release("0.9.9", "v0.10.0"));
        for tag in ["v0.9.9", "v0.9.8", "v1.0.0-beta.3", "latest", "v0"] {
            assert!(!newer_release("0.9.9", tag));
        }
    }
}
