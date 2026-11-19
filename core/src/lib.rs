use semver::Version;
pub mod dj;
pub mod media;

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
