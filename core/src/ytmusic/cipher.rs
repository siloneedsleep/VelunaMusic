use crate::ytmusic::client::InnerTubeClient;
use crate::ytmusic::models::YtmError;
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

const REGISTRY_URLS: [&str; 2] = [
    "https://raw.githubusercontent.com/maxrave-dev/simpmusic-files/main/registry/player_configs.json",
    "https://raw.githubusercontent.com/MetrolistGroup/faraday/master/registry/player_configs.json",
];
const FALLBACK_PLAYER_ID: &str = "983e9c18";
const FALLBACK_STS: u64 = 20773;
const PIPEPIPE_DECODER_URL: &str = "https://api.pipepipe.dev/decoder/decode";
const PIPEPIPE_UA: &str = "PipePipe/4.9.0";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CipherOp {
    Reverse,
    Splice(usize),
    Swap(usize),
}

#[derive(Debug, Clone)]
pub struct PlayerContext {
    pub player_id: String,
    pub sts: u64,
    pub sig_ops: Vec<CipherOp>,
    pub sig_spec: Option<String>,
    pub n_class: Option<String>,
}

pub struct CipherEngine {
    ctx: RwLock<Option<PlayerContext>>,
    decoded_cache: RwLock<HashMap<(String, &'static str, String), String>>,
}

impl Default for CipherEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl CipherEngine {
    pub fn new() -> Self {
        Self {
            ctx: RwLock::new(None),
            decoded_cache: RwLock::new(HashMap::new()),
        }
    }

    pub fn cached_sts(&self) -> Option<u64> {
        self.ctx.read().ok().and_then(|g| g.as_ref().map(|c| c.sts))
    }

    pub async fn ensure_player_context(
        &self,
        client: &InnerTubeClient,
    ) -> Result<PlayerContext, YtmError> {
        if let Ok(guard) = self.ctx.read() {
            if let Some(existing) = guard.as_ref() {
                return Ok(existing.clone());
            }
        }

        let player_id = self
            .fetch_player_id(client)
            .await
            .unwrap_or_else(|| FALLBACK_PLAYER_ID.to_string());
        let (sig_spec, n_class, reg_sts) = self
            .fetch_registry_config(client, &player_id)
            .await
            .unwrap_or((None, None, None));
        let base_js = self.fetch_base_js(client, &player_id).await.ok();

        let js_sts = base_js.as_deref().and_then(extract_sts_from_js);
        let sts = reg_sts.or(js_sts).unwrap_or(FALLBACK_STS);

        let sig_ops = base_js
            .as_deref()
            .map(|js| parse_sig_ops(js, sig_spec.as_deref()))
            .unwrap_or_default();

        let built = PlayerContext {
            player_id,
            sts,
            sig_ops,
            sig_spec,
            n_class,
        };

        if let Ok(mut guard) = self.ctx.write() {
            *guard = Some(built.clone());
        }
        Ok(built)
    }

    async fn fetch_player_id(&self, client: &InnerTubeClient) -> Option<String> {
        static PLAYER_ID_RE: OnceLock<Regex> = OnceLock::new();
        static HEX8_RE: OnceLock<Regex> = OnceLock::new();
        let re = PLAYER_ID_RE
            .get_or_init(|| Regex::new(r"player\\?/([a-f0-9]{8})\\?/").expect("player id regex"));
        if let Ok(resp) = client
            .http()
            .get("https://www.youtube.com/iframe_api")
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
            )
            .send()
            .await
        {
            if let Ok(text) = resp.text().await {
                if let Some(id) = re
                    .captures(&text)
                    .and_then(|c| c.get(1))
                    .map(|m| m.as_str().to_string())
                {
                    return Some(id);
                }
            }
        }
        let hex8 = HEX8_RE.get_or_init(|| Regex::new(r"\b([a-f0-9]{8})\b").expect("hex8 regex"));
        let latest = client
            .http()
            .get("https://api.pipepipe.dev/decoder/latest-player")
            .header("User-Agent", PIPEPIPE_UA)
            .send()
            .await
            .ok()?
            .text()
            .await
            .ok()?;
        hex8.captures(&latest)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
    }

    async fn fetch_registry_config(
        &self,
        client: &InnerTubeClient,
        player_id: &str,
    ) -> Option<(Option<String>, Option<String>, Option<u64>)> {
        for url in REGISTRY_URLS {
            let Ok(resp) = client.http().get(url).send().await else {
                continue;
            };
            let Ok(json) = resp.json::<Value>().await else {
                continue;
            };
            let target_id = json
                .get("aliases")
                .and_then(|a| a.get(player_id))
                .and_then(|v| v.as_str())
                .unwrap_or(player_id);
            let Some(entry) = json.get("players").and_then(|p| p.get(target_id)) else {
                continue;
            };
            let sig_spec = entry
                .get("sig")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let n_class = entry
                .get("nClass")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let sts = entry.get("sts").and_then(|v| v.as_u64());
            return Some((sig_spec, n_class, sts));
        }
        None
    }

    async fn fetch_base_js(
        &self,
        client: &InnerTubeClient,
        player_id: &str,
    ) -> Result<String, YtmError> {
        let url = format!(
            "https://www.youtube.com/s/player/{}/player_ias.vflset/en_GB/base.js",
            player_id
        );
        let resp = client
            .http()
            .get(&url)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
            )
            .send()
            .await?;
        Ok(resp.text().await?)
    }

    pub async fn decode_sig(
        &self,
        client: &InnerTubeClient,
        sig: &str,
    ) -> Result<String, YtmError> {
        let ctx = self.ensure_player_context(client).await?;
        let key = (ctx.player_id.clone(), "sig", sig.to_string());
        if let Some(hit) = self
            .decoded_cache
            .read()
            .ok()
            .and_then(|g| g.get(&key).cloned())
        {
            return Ok(hit);
        }

        let decoded = if !ctx.sig_ops.is_empty() {
            apply_cipher_ops(sig, &ctx.sig_ops)
        } else {
            self.remote_decode_one(client, &ctx.player_id, "sig", sig)
                .await?
        };

        if let Ok(mut guard) = self.decoded_cache.write() {
            guard.insert(key, decoded.clone());
        }
        Ok(decoded)
    }

    pub async fn decode_n(
        &self,
        client: &InnerTubeClient,
        n_val: &str,
    ) -> Result<String, YtmError> {
        let ctx = self.ensure_player_context(client).await?;
        let key = (ctx.player_id.clone(), "n", n_val.to_string());
        if let Some(hit) = self
            .decoded_cache
            .read()
            .ok()
            .and_then(|g| g.get(&key).cloned())
        {
            return Ok(hit);
        }

        let decoded = self
            .remote_decode_one(client, &ctx.player_id, "n", n_val)
            .await?;
        if let Ok(mut guard) = self.decoded_cache.write() {
            guard.insert(key, decoded.clone());
        }
        Ok(decoded)
    }

    async fn remote_decode_one(
        &self,
        client: &InnerTubeClient,
        player_id: &str,
        kind: &str,
        input: &str,
    ) -> Result<String, YtmError> {
        let query_param = if kind == "sig" { "sig" } else { "n" };
        let url = format!(
            "{}?player={}&{}={}",
            PIPEPIPE_DECODER_URL,
            urlencoding::encode(player_id),
            query_param,
            urlencoding::encode(input)
        );
        let resp = client
            .http()
            .get(&url)
            .header("User-Agent", PIPEPIPE_UA)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(YtmError::Protocol(format!(
                "Decoder HTTP {}",
                resp.status()
            )));
        }
        let body: Value = resp.json().await?;
        let decoded = body
            .get("responses")
            .and_then(|r| r.as_array())
            .and_then(|arr| arr.first())
            .and_then(|item| item.get("data"))
            .and_then(|data| data.get(input))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| {
                YtmError::Protocol(format!("Missing decoded {} value in response", kind))
            })?;
        Ok(decoded)
    }

    pub async fn deobfuscate_url(
        &self,
        client: &InnerTubeClient,
        raw_url: Option<&str>,
        signature_cipher: Option<&str>,
        decode_n_param: bool,
    ) -> Result<String, YtmError> {
        if let Some(cipher_str) = signature_cipher {
            let mut base_url = None;
            let mut s_val = None;
            let mut sp_val = "sig".to_string();

            for pair in cipher_str.split('&') {
                if let Some((k, v)) = pair.split_once('=') {
                    let decoded = urlencoding::decode(v)
                        .map(|c| c.into_owned())
                        .unwrap_or_else(|_| v.to_string());
                    match k {
                        "url" => base_url = Some(decoded),
                        "s" => s_val = Some(decoded),
                        "sp" if !decoded.is_empty() => sp_val = decoded,
                        _ => {}
                    }
                }
            }

            let mut url =
                base_url.ok_or_else(|| YtmError::Protocol("signatureCipher missing url".into()))?;

            if let Some(raw_sig) = s_val {
                let decoded_sig = self.decode_sig(client, &raw_sig).await?;
                url = append_or_replace_param(&url, &sp_val, &decoded_sig);
            }

            if decode_n_param {
                if let Some(raw_n) = extract_query_param_raw(&url, "n") {
                    if let Ok(decoded_n) = self.decode_n(client, &raw_n).await {
                        url = replace_query_param_in_place(&url, "n", &decoded_n);
                    }
                }
            }

            return Ok(url);
        }

        let mut url = raw_url
            .map(|s| s.to_string())
            .ok_or_else(|| YtmError::Protocol("Format missing url and signatureCipher".into()))?;

        if decode_n_param {
            if let Some(raw_n) = extract_query_param_raw(&url, "n") {
                if let Ok(decoded_n) = self.decode_n(client, &raw_n).await {
                    url = replace_query_param_in_place(&url, "n", &decoded_n);
                }
            }
        }

        Ok(url)
    }
}

pub fn apply_cipher_ops(input: &str, ops: &[CipherOp]) -> String {
    let mut chars: Vec<char> = input.chars().collect();
    if chars.is_empty() {
        return String::new();
    }
    for op in ops {
        match *op {
            CipherOp::Reverse => chars.reverse(),
            CipherOp::Splice(n) => {
                let count = n.min(chars.len());
                chars.drain(0..count);
            }
            CipherOp::Swap(n) => {
                let idx = n % chars.len();
                chars.swap(0, idx);
            }
        }
    }
    chars.into_iter().collect()
}

pub fn extract_sts_from_js(js: &str) -> Option<u64> {
    static STS_RE: OnceLock<Regex> = OnceLock::new();
    let re = STS_RE.get_or_init(|| Regex::new(r"signatureTimestamp\s*:\s*(\d+)").expect("sts re"));
    re.captures(js)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<u64>().ok())
}

pub fn extract_query_param_raw(url: &str, key: &str) -> Option<String> {
    let (_, query) = url.split_once('?')?;
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == key {
                return Some(
                    urlencoding::decode(v)
                        .map(|c| c.into_owned())
                        .unwrap_or_else(|_| v.to_string()),
                );
            }
        }
    }
    None
}

pub fn replace_query_param_in_place(url: &str, key: &str, new_val: &str) -> String {
    let Ok(re) = Regex::new(&format!(r"([?&]{}=)[^&]+", regex::escape(key))) else {
        return url.to_string();
    };
    if re.is_match(url) {
        let encoded = urlencoding::encode(new_val);
        re.replace(url, format!("${{1}}{}", encoded)).into_owned()
    } else {
        append_or_replace_param(url, key, new_val)
    }
}

pub fn append_or_replace_param(url: &str, key: &str, new_val: &str) -> String {
    let Ok(re) = Regex::new(&format!(r"([?&]{}=)[^&]+", regex::escape(key))) else {
        return url.to_string();
    };
    let encoded = urlencoding::encode(new_val);
    if re.is_match(url) {
        re.replace(url, format!("${{1}}{}", encoded)).into_owned()
    } else if url.contains('?') {
        format!("{}&{}={}", url, key, encoded)
    } else {
        format!("{}?{}={}", url, key, encoded)
    }
}

pub fn parse_sig_ops(js: &str, sig_spec: Option<&str>) -> Vec<CipherOp> {
    if let Some(spec) = sig_spec {
        let modern = parse_modern_sig_ops(js, spec);
        if !modern.is_empty() {
            return modern;
        }
    }
    parse_classic_sig_ops(js)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HelperMethodKind {
    Reverse,
    Splice,
    Swap,
}

fn find_string_table(js: &str) -> Option<(String, Vec<String>)> {
    static TBL_RE: OnceLock<Regex> = OnceLock::new();
    let re = TBL_RE.get_or_init(|| {
        Regex::new(r#"var\s+([A-Za-z0-9_$]+)\s*=\s*"([^"]{20,})"\s*\.split\("([^"]+)"\)"#)
            .expect("table regex")
    });
    for cap in re.captures_iter(js) {
        let var_name = cap.get(1)?.as_str();
        let raw = cap.get(2)?.as_str();
        let delim = cap.get(3)?.as_str();
        if raw.contains("reverse") && raw.contains("splice") {
            let items: Vec<String> = raw.split(delim).map(|s| s.to_string()).collect();
            return Some((var_name.to_string(), items));
        }
    }
    None
}

fn extract_sig_spec_parts(spec: &str) -> Option<(String, usize, usize)> {
    static SPEC_RE: OnceLock<Regex> = OnceLock::new();
    let re =
        SPEC_RE.get_or_init(|| Regex::new(r"^([A-Za-z0-9_$]+)\((\d+),(\d+),").expect("spec regex"));
    let cap = re.captures(spec.trim())?;
    let fn_name = cap.get(1)?.as_str().to_string();
    let a = cap.get(2)?.as_str().parse::<usize>().ok()?;
    let b = cap.get(3)?.as_str().parse::<usize>().ok()?;
    Some((fn_name, a, b))
}

fn extract_js_function_body(js: &str, fn_name: &str) -> Option<String> {
    let needle = format!("{} = function(", fn_name);
    let alt_needle = format!("{}=function(", fn_name);
    let start = js.find(&alt_needle).or_else(|| js.find(&needle))?;
    let brace_open = js[start..].find('{')? + start;
    let mut depth = 0i32;
    let mut in_str = None::<u8>;
    let mut escape = false;
    let bytes = js.as_bytes();
    for i in brace_open..bytes.len() {
        let ch = bytes[i];
        if let Some(q) = in_str {
            if escape {
                escape = false;
            } else if ch == b'\\' {
                escape = true;
            } else if ch == q {
                in_str = None;
            }
            continue;
        }
        match ch {
            b'"' | b'\'' | b'`' => in_str = Some(ch),
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(js[brace_open..=i].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

fn parse_helper_object(
    js: &str,
    obj_name: &str,
    table: &[String],
) -> HashMap<String, HelperMethodKind> {
    static METHOD_RE: OnceLock<Regex> = OnceLock::new();
    static TBL_IDX_RE: OnceLock<Regex> = OnceLock::new();
    let mut map = HashMap::new();
    let pattern = format!("var {}={{", obj_name);
    let alt_pattern = format!("var {} = {{", obj_name);
    let Some(start) = js.find(&pattern).or_else(|| js.find(&alt_pattern)) else {
        return map;
    };
    let mut bound = (start + 1500).min(js.len());
    while bound > start && !js.is_char_boundary(bound) {
        bound -= 1;
    }
    let slice = &js[start..bound];
    let Some(end) = slice.find("};") else {
        return map;
    };
    let obj_body = &slice[..end];

    let method_re = METHOD_RE.get_or_init(|| {
        Regex::new(r"([A-Za-z0-9_$]+)\s*:\s*function\([^)]*\)\s*\{([^}]*)\}")
            .expect("helper method regex")
    });
    let tbl_idx_re = TBL_IDX_RE
        .get_or_init(|| Regex::new(r"\[[A-Za-z0-9_$]+\[(\d+)\]\]").expect("tbl idx regex"));

    for cap in method_re.captures_iter(obj_body) {
        let m_name = cap[1].to_string();
        let m_body = &cap[2];
        let mut kind = None;
        if m_body.contains('%') || m_body.contains("var ") {
            kind = Some(HelperMethodKind::Swap);
        } else if m_body.contains(".reverse(") {
            kind = Some(HelperMethodKind::Reverse);
        } else if m_body.contains(".splice(") {
            kind = Some(HelperMethodKind::Splice);
        } else if let Some(idx_cap) = tbl_idx_re.captures(m_body) {
            if let Ok(idx) = idx_cap[1].parse::<usize>() {
                match table.get(idx).map(|s| s.as_str()) {
                    Some("reverse") => kind = Some(HelperMethodKind::Reverse),
                    Some("splice") => kind = Some(HelperMethodKind::Splice),
                    _ => {}
                }
            }
        }
        if let Some(k) = kind {
            map.insert(m_name, k);
        }
    }
    map
}

fn parse_modern_sig_ops(js: &str, spec: &str) -> Vec<CipherOp> {
    let Some((fn_name, arg_a, arg_b)) = extract_sig_spec_parts(spec) else {
        return Vec::new();
    };
    let Some((tbl_name, table)) = find_string_table(js) else {
        return Vec::new();
    };
    let Some(fn_body) = extract_js_function_body(js, &fn_name) else {
        return Vec::new();
    };

    let branch = if let Some(pos) = fn_body.find("|32)==a") {
        let rest = &fn_body[pos..];
        rest.split("else").next().unwrap_or(rest)
    } else {
        fn_body.as_str()
    };

    let d_xor = arg_a ^ arg_b;
    let Ok(obj_call_re) = Regex::new(&format!(
        r"([A-Za-z0-9_$]+)\[{}\[([^\]]+)\]\]\([A-Za-z0-9_$]+\s*,\s*([^)]+)\)",
        regex::escape(&tbl_name)
    )) else {
        return Vec::new();
    };

    let mut helper_name = None;
    for cap in obj_call_re.captures_iter(branch) {
        let candidate = &cap[1];
        if candidate != tbl_name {
            helper_name = Some(candidate.to_string());
            break;
        }
    }
    let Some(obj_name) = helper_name else {
        return Vec::new();
    };

    let methods = parse_helper_object(js, &obj_name, &table);
    if methods.is_empty() {
        return Vec::new();
    }

    let mut ops = Vec::new();
    for cap in obj_call_re.captures_iter(branch) {
        if cap[1] != obj_name {
            continue;
        }
        let Some(tbl_idx) = eval_xor_expr(&cap[2], d_xor) else {
            return Vec::new();
        };
        let Some(m_name) = table.get(tbl_idx) else {
            return Vec::new();
        };
        let Some(kind) = methods.get(m_name) else {
            return Vec::new();
        };
        let Some(arg_val) = eval_xor_expr(&cap[3], d_xor) else {
            return Vec::new();
        };
        match kind {
            HelperMethodKind::Reverse => ops.push(CipherOp::Reverse),
            HelperMethodKind::Splice => ops.push(CipherOp::Splice(arg_val)),
            HelperMethodKind::Swap => ops.push(CipherOp::Swap(arg_val)),
        }
    }
    ops
}

fn eval_xor_expr(expr: &str, d_val: usize) -> Option<usize> {
    let trimmed = expr.trim();
    if let Ok(n) = trimmed.parse::<usize>() {
        return Some(n);
    }
    if let Some((lhs, rhs)) = trimmed.split_once('^') {
        let l = lhs.trim();
        let r = rhs.trim();
        if let Ok(rv) = r.parse::<usize>() {
            if l.chars().all(|c| c.is_ascii_alphabetic()) {
                return Some(d_val ^ rv);
            }
        }
        if let Ok(lv) = l.parse::<usize>() {
            if r.chars().all(|c| c.is_ascii_alphabetic()) {
                return Some(d_val ^ lv);
            }
        }
    }
    None
}

fn parse_classic_sig_ops(js: &str) -> Vec<CipherOp> {
    static CLASSIC_FN_RE: OnceLock<Regex> = OnceLock::new();
    let fn_re = CLASSIC_FN_RE.get_or_init(|| {
        Regex::new(r#"function\([a-zA-Z0-9_$]+\)\{[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\.split\(""\);([^}]+);return [a-zA-Z0-9_$]+\.join\(""\)\}"#)
            .expect("classic fn re")
    });
    let Some(cap) = fn_re.captures(js) else {
        return Vec::new();
    };
    let steps = &cap[1];
    static STEP_RE: OnceLock<Regex> = OnceLock::new();
    let step_re = STEP_RE.get_or_init(|| {
        Regex::new(r"([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)\([A-Za-z0-9_$]+,(\d+)\)").expect("step re")
    });
    let Some(obj) = step_re.captures(steps).map(|s| s[1].to_owned()) else {
        return Vec::new();
    };
    let methods = parse_helper_object(js, &obj, &[]);
    let mut ops = Vec::new();
    for s in step_re.captures_iter(steps) {
        if s[1] != obj {
            continue;
        }
        let Ok(arg) = s[3].parse::<usize>() else {
            continue;
        };
        match methods.get(&s[2]) {
            Some(HelperMethodKind::Reverse) => ops.push(CipherOp::Reverse),
            Some(HelperMethodKind::Splice) => ops.push(CipherOp::Splice(arg)),
            Some(HelperMethodKind::Swap) => ops.push(CipherOp::Swap(arg)),
            None => {}
        }
    }
    ops
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cipher_ops_and_inplace_url_patching() {
        let ops = vec![CipherOp::Swap(2), CipherOp::Reverse, CipherOp::Splice(1)];
        assert_eq!(apply_cipher_ops("abcdef", &ops), "edabc");

        let raw = "https://rr1---sn.googlevideo.com/videoplayback?expire=1700000&sparams=expire%2Cei&n=OLD_N_VAL&lsig=AB%2CCD";
        let patched = replace_query_param_in_place(raw, "n", "NEW+N/VAL");
        assert!(patched.contains("sparams=expire%2Cei&"));
        assert!(patched.contains("n=NEW%2BN%2FVAL&lsig=AB%2CCD"));

        let signed = append_or_replace_param(&patched, "sig", "XYZ=1");
        assert!(signed.ends_with("&sig=XYZ%3D1"));
        assert!(signed.contains("lsig=AB%2CCD"));
    }

    #[test]
    fn modern_cipher_parser_extracts_ops() {
        let fake_js = r#"
var QF={w4:function(a,b){a.splice(0,b)},K9:function(a){a.reverse()},r2:function(a,b){var c=a[0];a[0]=a[b%a.length];a[b%a.length]=c}};
var aa="foo;w4;reverse;K9;splice;r2;join".split(";");
Yx = function(a, b, c) {
  var d;
  if ((a | 32) == a) {
    d = b ^ a;
    var e = c.split("");
    QF[aa[d ^ 6762]](e, d ^ 6760);
    QF[aa[d ^ 6760]](e, d ^ 6761);
    QF[aa[d ^ 6766]](e, d ^ 6767);
    return e.join("");
  }
  return c;
};
"#;
        let ops = parse_sig_ops(fake_js, Some("Yx(33,6730,INPUT)"));
        assert_eq!(
            ops,
            vec![CipherOp::Splice(3), CipherOp::Reverse, CipherOp::Swap(4),]
        );
    }

    #[test]
    fn helper_object_parser_handles_multibyte_utf8_at_slice_boundary() {
        let mut js = String::from("var QF={w4:function(a,b){a.splice(0,b)}};");
        js.push_str(&"a".repeat(1458));
        js.push('ế');
        js.push_str("tail");
        let map = parse_helper_object(&js, "QF", &[]);
        assert!(matches!(map.get("w4"), Some(HelperMethodKind::Splice)));
    }
}
