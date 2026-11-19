use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use tokio::sync::OnceCell;
use veluna_core::ytmusic::{shared_service, valid_video_id};

static ADDRESS: OnceCell<String> = OnceCell::const_new();

pub async fn media_url(id: &str) -> Result<String, String> {
    let base = ADDRESS.get_or_try_init(start).await?;
    Ok(format!("{base}/{id}"))
}

async fn start() -> Result<String, String> {
    let mut random = [0u8; 32];
    getrandom::fill(&mut random).map_err(|_| "Media server initialization failed")?;
    let token = URL_SAFE_NO_PAD.encode(random);
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|e| e.to_string())?;
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(12))
        .read_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| "Media client initialization failed")?;
    let router = Router::new()
        .route(&format!("/{token}/{{id}}"), get(media))
        .with_state(client);
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    Ok(format!("http://{address}/{token}"))
}

async fn media(
    Path(id): Path<String>,
    State(client): State<reqwest::Client>,
    method: Method,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    if !valid_video_id(&id) {
        return Err(StatusCode::NOT_FOUND);
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
    let info = shared_service()
        .direct_stream(&id, false)
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    let mut request = client.request(method, &info.url);
    if let Some(range) = headers.get(header::RANGE) {
        let range = range
            .to_str()
            .map_err(|_| StatusCode::RANGE_NOT_SATISFIABLE)?;
        if !valid_range(range) {
            return Err(StatusCode::RANGE_NOT_SATISFIABLE);
        }
        request = request.header(header::RANGE, range);
    }
    let upstream = request.send().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
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
    #[test]
    fn single_range_supports_seek_and_suffix() {
        for range in ["bytes=0-", "bytes=52-600", "bytes=-64"] {
            assert!(super::valid_range(range));
        }
        for range in ["bytes=-", "bytes=9-3", "bytes=0-8,9-10", "bytes=x-1"] {
            assert!(!super::valid_range(range));
        }
    }
}
