use windows_sys::Win32::Security::Credentials::*;

fn target(slot: &str) -> Result<Vec<u16>, String> {
    if !matches!(slot, "account" | "dj-openai" | "dj-openrouter") {
        return Err("Unknown credential".into());
    }
    Ok(format!("VelunaMusic/{slot}\0").encode_utf16().collect())
}

#[tauri::command]
pub fn read_secret(slot: String) -> Result<String, String> {
    let name = target(&slot)?;
    let mut raw = std::ptr::null_mut();
    // Credential Manager owns this buffer until CredFree.
    unsafe {
        if CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) == 0 {
            let err = std::io::Error::last_os_error();
            return if err.raw_os_error() == Some(1168) {
                Ok(String::new())
            } else {
                Err(err.to_string())
            };
        }
        let value = if (*raw).CredentialBlobSize == 0 {
            Ok(String::new())
        } else {
            let bytes = std::slice::from_raw_parts(
                (*raw).CredentialBlob,
                (*raw).CredentialBlobSize as usize,
            );
            String::from_utf8(bytes.to_owned()).map_err(|e| e.to_string())
        };
        CredFree(raw.cast());
        value
    }
}

#[tauri::command]
pub fn write_secret(slot: String, value: String) -> Result<(), String> {
    let mut name = target(&slot)?;
    if value.len() > 2500 {
        return Err("Credential is too long".into());
    }
    unsafe {
        if value.is_empty() {
            if CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0) == 0 {
                let err = std::io::Error::last_os_error();
                if err.raw_os_error() != Some(1168) {
                    return Err(err.to_string());
                }
            }
        } else {
            let credential = CREDENTIALW {
                Type: CRED_TYPE_GENERIC,
                TargetName: name.as_mut_ptr(),
                CredentialBlobSize: value.len() as u32,
                CredentialBlob: value.as_ptr().cast_mut(),
                Persist: CRED_PERSIST_LOCAL_MACHINE,
                ..Default::default()
            };
            if CredWriteW(&credential, 0) == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
        }
    }
    Ok(())
}
