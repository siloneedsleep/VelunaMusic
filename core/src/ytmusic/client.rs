use crate::ytmusic::models::YtmError;
use regex::Regex;
use reqwest::Client;
use serde_json::{json, Map, Value};
use std::sync::{OnceLock, RwLock};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InnerTubeClientKind {
    WebRemix,
    AndroidMusic,
    VisionOs,
    TvHtml5,
    Android,
}

impl InnerTubeClientKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            InnerTubeClientKind::WebRemix => "WEB_REMIX",
            InnerTubeClientKind::AndroidMusic => "ANDROID_MUSIC",
            InnerTubeClientKind::VisionOs => "VISIONOS",
            InnerTubeClientKind::TvHtml5 => "TVHTML5",
            InnerTubeClientKind::Android => "ANDROID",
        }
    }

    pub fn client_version(&self) -> &'static str {
        match self {
            InnerTubeClientKind::WebRemix => "1.20260304.03.00",
            InnerTubeClientKind::AndroidMusic => "7.27.52",
            InnerTubeClientKind::VisionOs => "1.02",
            InnerTubeClientKind::TvHtml5 => "7.20250312.16.00",
            InnerTubeClientKind::Android => "21.26.364",
        }
    }

    pub fn client_id(&self) -> &'static str {
        match self {
            InnerTubeClientKind::WebRemix => "67",
            InnerTubeClientKind::AndroidMusic => "21",
            InnerTubeClientKind::VisionOs => "101",
            InnerTubeClientKind::TvHtml5 => "7",
            InnerTubeClientKind::Android => "3",
        }
    }

    pub fn api_base(&self) -> &'static str {
        match self {
            InnerTubeClientKind::WebRemix | InnerTubeClientKind::AndroidMusic => {
                "https://music.youtube.com/youtubei/v1"
            }
            InnerTubeClientKind::VisionOs | InnerTubeClientKind::Android => {
                "https://youtubei.googleapis.com/youtubei/v1"
            }
            InnerTubeClientKind::TvHtml5 => "https://www.youtube.com/youtubei/v1",
        }
    }

    pub fn origin(&self) -> &'static str {
        match self {
            InnerTubeClientKind::WebRemix | InnerTubeClientKind::AndroidMusic => {
                "https://music.youtube.com"
            }
            InnerTubeClientKind::VisionOs
            | InnerTubeClientKind::TvHtml5
            | InnerTubeClientKind::Android => "https://www.youtube.com",
        }
    }

    pub fn user_agent(&self) -> &'static str {
        match self {
            InnerTubeClientKind::WebRemix => {
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"
            }
            InnerTubeClientKind::AndroidMusic => {
                "com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 14; en_US; Pixel 8 Pro Build/UQ1A.240205.004) gzip"
            }
            InnerTubeClientKind::VisionOs => {
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
            }
            InnerTubeClientKind::TvHtml5 => {
                "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version"
            }
            InnerTubeClientKind::Android => {
                "com.google.android.youtube/21.26.364 (Linux; U; Android 15) gzip"
            }
        }
    }
}

pub struct InnerTubeClient {
    http: Client,
    visitor_id: RwLock<Option<String>>,
}

impl Default for InnerTubeClient {
    fn default() -> Self {
        Self::new()
    }
}

impl InnerTubeClient {
    pub fn new() -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            http,
            visitor_id: RwLock::new(None),
        }
    }

    pub fn http(&self) -> &Client {
        &self.http
    }

    pub fn cached_visitor_id(&self) -> Option<String> {
        self.visitor_id.read().ok().and_then(|g| g.clone())
    }

    pub async fn ensure_visitor_id(&self) -> String {
        if let Some(existing) = self.cached_visitor_id() {
            return existing;
        }
        let fetched = self.fetch_visitor_data_from_sw().await;
        let resolved = fetched.unwrap_or_default();
        if let Ok(mut guard) = self.visitor_id.write() {
            *guard = Some(resolved.clone());
        }
        resolved
    }

    async fn fetch_visitor_data_from_sw(&self) -> Option<String> {
        static VISITOR_RE: OnceLock<Regex> = OnceLock::new();
        let re = VISITOR_RE.get_or_init(|| {
            Regex::new(r"Cg[stuv][A-Za-z0-9_-]{15,}(?:%3D)*").expect("visitor regex")
        });

        let text = self
            .http
            .get("https://music.youtube.com/sw.js_data")
            .header("User-Agent", InnerTubeClientKind::WebRemix.user_agent())
            .header("Referer", "https://music.youtube.com/")
            .send()
            .await
            .ok()?
            .text()
            .await
            .ok()?;

        re.find(&text).map(|m| m.as_str().to_string())
    }

    pub fn build_context(&self, kind: InnerTubeClientKind, visitor_id: &str) -> Value {
        let mut client = Map::new();
        client.insert("clientName".into(), Value::String(kind.as_str().into()));
        client.insert(
            "clientVersion".into(),
            Value::String(kind.client_version().into()),
        );
        client.insert("hl".into(), Value::String("en".into()));
        client.insert("gl".into(), Value::String("US".into()));
        if !visitor_id.is_empty() {
            client.insert("visitorData".into(), Value::String(visitor_id.into()));
        }

        match kind {
            InnerTubeClientKind::WebRemix => {}
            InnerTubeClientKind::AndroidMusic => {
                client.insert("androidSdkVersion".into(), json!(34));
                client.insert("osName".into(), Value::String("Android".into()));
                client.insert("osVersion".into(), Value::String("14".into()));
                client.insert("platform".into(), Value::String("MOBILE".into()));
            }
            InnerTubeClientKind::VisionOs => {
                client.insert("clientScreen".into(), Value::String("WATCH".into()));
                client.insert("platform".into(), Value::String("MOBILE".into()));
                client.insert("deviceMake".into(), Value::String("Apple".into()));
                client.insert(
                    "deviceModel".into(),
                    Value::String("RealityDevice14,1".into()),
                );
                client.insert("osName".into(), Value::String("visionOS".into()));
                client.insert("osVersion".into(), Value::String("25.6.0.23O471".into()));
            }
            InnerTubeClientKind::TvHtml5 => {
                client.insert("clientScreen".into(), Value::String("WATCH".into()));
                client.insert("platform".into(), Value::String("TV".into()));
            }
            InnerTubeClientKind::Android => {
                client.insert("androidSdkVersion".into(), json!(35));
                client.insert("osName".into(), Value::String("Android".into()));
                client.insert("osVersion".into(), Value::String("15".into()));
                client.insert("platform".into(), Value::String("MOBILE".into()));
            }
        }

        json!({
            "client": Value::Object(client),
            "user": {
                "lockedSafetyMode": false
            }
        })
    }

    pub async fn post_innertube(
        &self,
        kind: InnerTubeClientKind,
        endpoint: &str,
        payload: Value,
    ) -> Result<Value, YtmError> {
        let visitor = self.ensure_visitor_id().await;
        let url = format!("{}/{}?prettyPrint=false", kind.api_base(), endpoint);

        let mut body_map = match payload {
            Value::Object(map) => map,
            _ => Map::new(),
        };
        body_map.insert("context".into(), self.build_context(kind, &visitor));

        let request = self
            .http
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("X-YouTube-Client-Name", kind.client_id())
            .header("X-YouTube-Client-Version", kind.client_version())
            .header("Origin", kind.origin())
            .header("Referer", format!("{}/", kind.origin()))
            .header("User-Agent", kind.user_agent())
            .json(&Value::Object(body_map));
        let request = if visitor.is_empty() {
            request
        } else {
            request.header("X-Goog-Visitor-Id", &visitor)
        };
        let resp = request.send().await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(YtmError::Protocol(format!(
                "InnerTube {} {} returned HTTP {}",
                kind.as_str(),
                endpoint,
                status
            )));
        }

        let value: Value = serde_json::from_str(&text)?;
        if let Some(new_visitor) = value
            .get("responseContext")
            .and_then(|c| c.get("visitorData"))
            .and_then(|v| v.as_str())
        {
            if !new_visitor.is_empty() && visitor.is_empty() {
                if let Ok(mut guard) = self.visitor_id.write() {
                    *guard = Some(new_visitor.to_string());
                }
            }
        }
        Ok(value)
    }

    pub async fn browse_home(
        &self,
        params: Option<&str>,
        continuation: Option<&str>,
    ) -> Result<Value, YtmError> {
        let mut payload = Map::new();
        if let Some(token) = continuation.map(str::trim).filter(|s| !s.is_empty()) {
            payload.insert("continuation".into(), Value::String(token.to_string()));
        } else {
            payload.insert("browseId".into(), Value::String("FEmusic_home".into()));
            if let Some(p) = params.map(str::trim).filter(|s| !s.is_empty()) {
                payload.insert("params".into(), Value::String(p.to_string()));
            }
        }
        self.post_innertube(InnerTubeClientKind::WebRemix, "browse", Value::Object(payload))
            .await
    }
}
