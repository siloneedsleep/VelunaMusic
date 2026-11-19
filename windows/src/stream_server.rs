use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use std::path::{Component, Path as FsPath, PathBuf};
use tokio::sync::OnceCell;
use veluna_core::ytmusic::{shared_service, valid_video_id};

static ADDRESS: OnceCell<String> = OnceCell::const_new();

#[derive(Clone)]
struct StreamState {
    client: reqwest::Client,
    token: String,
}

pub async fn media_url(id: &str) -> Result<String, String> {
    if has_path_traversal(id) || !valid_video_id(id) {
        return Err("Invalid stream identifier".into());
    }
    let base = ADDRESS.get_or_try_init(start).await?;
    Ok(format!("{base}/{id}"))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn has_path_traversal(segment: &str) -> bool {
    segment.is_empty()
        || segment.contains("..")
        || segment.contains('/')
        || segment.contains('\\')
        || segment.contains('%')
        || segment.bytes().any(|b| b == 0 || b.is_ascii_control())
}

pub fn safe_contained_path(root: &FsPath, candidate: &FsPath) -> Option<PathBuf> {
    if candidate.as_os_str().is_empty()
        || candidate.to_string_lossy().contains('\0')
        || candidate
            .components()
            .any(|c| matches!(c, Component::ParentDir))
    {
        return None;
    }
    let canon_root = std::fs::canonicalize(root).ok()?;
    let canon_file = std::fs::canonicalize(candidate).ok()?;
    if canon_file.starts_with(&canon_root) && canon_file.is_file() {
        Some(canon_file)
    } else {
        None
    }
}

async fn start() -> Result<String, String> {
    let mut random = [0u8; 32];
    getrandom::fill(&mut random).map_err(|_| "Media server initialization failed")?;
    let token = URL_SAFE_NO_PAD.encode(random);
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|e| e.to_string())?;
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    let client = veluna_core::http::build_stream_client(
        std::time::Duration::from_secs(12),
        std::time::Duration::from_secs(30),
    )
    .map_err(|_| "Media client initialization failed")?;
    let state = StreamState {
        client,
        token: token.clone(),
    };
    let router = Router::new()
        .route("/{token}/{id}", get(media))
        .with_state(state);
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    Ok(format!("http://{address}/{token}"))
}

async fn media(
    Path((req_token, id)): Path<(String, String)>,
    State(state): State<StreamState>,
    method: Method,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    if has_path_traversal(&req_token)
        || !constant_time_eq(req_token.as_bytes(), state.token.as_bytes())
    {
        return Err(StatusCode::FORBIDDEN);
    }
    if has_path_traversal(&id) || !valid_video_id(&id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let origin = headers.get(header::ORIGIN);
    if origin.is_some_and(|o| {
        !matches!(
            o.to_str(),
            Ok("http://tauri.localhost" | "https://tauri.localhost" | "tauri://localhost")
        )
    }) {
        return Err(StatusCode::FORBIDDEN);
    }
    let range_header = match headers.get(header::RANGE) {
        Some(range) => {
            let range = range
                .to_str()
                .map_err(|_| StatusCode::RANGE_NOT_SATISFIABLE)?;
            if !valid_range(range) {
                return Err(StatusCode::RANGE_NOT_SATISFIABLE);
            }
            Some(range.to_string())
        }
        None => None,
    };
    let send_upstream = |url: &str| {
        let mut req = state.client.request(method.clone(), url);
        if let Some(ref range) = range_header {
            req = req.header(header::RANGE, range);
        }
        req.send()
    };
    let info = shared_service()
        .direct_stream(&id, false)
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    let mut upstream = send_upstream(&info.url)
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    if matches!(upstream.status(), StatusCode::FORBIDDEN | StatusCode::GONE) {
        if let Ok(refreshed) = shared_service().direct_stream(&id, true).await {
            if let Ok(retried) = send_upstream(&refreshed.url).await {
                upstream = retried;
            }
        }
    }
    let status = upstream.status();
    if !matches!(
        status,
        StatusCode::OK | StatusCode::PARTIAL_CONTENT | StatusCode::RANGE_NOT_SATISFIABLE
    ) {
        return Err(StatusCode::BAD_GATEWAY);
    }
    let mut response = Response::builder()
        .status(status)
        .header(header::CACHE_CONTROL, "no-store");
    for key in [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
    ] {
        if let Some(value) = upstream.headers().get(&key) {
            response = response.header(key, value);
        }
    }
    if let Some(origin) = origin {
        response = response
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
            .header(header::VARY, "Origin");
    }
    response
        .body(Body::from_stream(upstream.bytes_stream()))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

fn valid_range(header: &str) -> bool {
    let Some((first, last)) = header
        .strip_prefix("bytes=")
        .and_then(|r| r.split_once('-'))
    else {
        return false;
    };
    match (first.parse::<u64>(), last.parse::<u64>()) {
        (Ok(start), Ok(end)) => start <= end,
        (Ok(_), Err(_)) => last.is_empty(),
        (Err(_), Ok(count)) => first.is_empty() && count > 0,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_range_supports_seek_and_suffix() {
        for range in ["bytes=0-", "bytes=52-600", "bytes=-64"] {
            assert!(valid_range(range));
        }
        for range in ["bytes=-", "bytes=9-3", "bytes=0-8,9-10", "bytes=x-1"] {
            assert!(!valid_range(range));
        }
    }

    #[test]
    fn capability_token_and_path_traversal_guards_block_unsafe_inputs() {
        assert!(constant_time_eq(b"secret-token-123", b"secret-token-123"));
        assert!(!constant_time_eq(b"secret-token-123", b"secret-token-124"));
        assert!(!constant_time_eq(b"short", b"longer"));

        for bad in ["", "../etc", "..\\win", "abc/def", "a%2e%2eb", "id\0null"] {
            assert!(has_path_traversal(bad), "expected rejection for {bad:?}");
        }
        assert!(!has_path_traversal("aB1_CD-2345"));

        let base = std::env::temp_dir().join(format!(
            "veluna-stream-guard-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let root = base.join("offline");
        let outside = base.join("outside.txt");
        let inside = root.join("track.webm");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&outside, b"secret").unwrap();
        std::fs::write(&inside, b"audio").unwrap();

        assert!(safe_contained_path(&root, &inside).is_some());
        assert!(safe_contained_path(&root, &outside).is_none());
        assert!(safe_contained_path(&root, &root.join("..").join("outside.txt")).is_none());

        let _ = std::fs::remove_dir_all(base);
    }
}
