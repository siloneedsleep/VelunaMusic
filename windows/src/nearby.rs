use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use rustls::{
    pki_types::{CertificateDer, PrivatePkcs8KeyDer},
    ServerConfig, ServerConnection, StreamOwned,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{self, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

const MAX_BYTES: u64 = 512 * 1024 * 1024;
const SERVICE: &str = "_velunamusic._tcp.local.";
type Decision = Option<(String, mpsc::SyncSender<bool>)>;
#[derive(Default)]
pub struct Nearby(Mutex<Option<Arc<Receiver>>>);
struct Receiver {
    stop: AtomicBool,
    sessions: AtomicUsize,
    address: SocketAddr,
    token: String,
    created: Instant,
    tls: Arc<ServerConfig>,
    pin: String,
    decision: Mutex<Decision>,
    app: AppHandle,
    peers: Mutex<HashMap<String, String>>,
    daemon: Option<mdns_sd::ServiceDaemon>,
}
#[derive(Serialize, Deserialize)]
struct Identity {
    cert: String,
    key: String,
}
#[derive(Serialize)]
pub struct Invitation {
    link: String,
    qr: Vec<Vec<bool>>,
    address: String,
}
#[derive(Deserialize)]
struct Header {
    kind: String,
    key: String,
    #[serde(default)]
    token: String,
    #[serde(default)]
    device: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    digest: String,
    #[serde(default)]
    action: String,
}
fn err(e: impl ToString) -> String {
    e.to_string()
}
fn random() -> Result<String, String> {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).map_err(err)?;
    Ok(B64.encode(b))
}
fn digest_hex(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}
fn state_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let root = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(&root).map_err(err)?;
    Ok(root.join("nearby-peers.json"))
}
fn tls_identity() -> Result<(ServerConfig, String), String> {
    let saved = super::vault::read_local("lan-identity")?;
    let identity: Identity = if saved.is_empty() {
        let generated =
            rcgen::generate_simple_self_signed(vec!["velunamusic.local".into()]).map_err(err)?;
        let i = Identity {
            cert: B64.encode(generated.cert.der()),
            key: B64.encode(generated.key_pair.serialize_der()),
        };
        super::vault::write_local("lan-identity", &serde_json::to_string(&i).map_err(err)?)?;
        i
    } else {
        serde_json::from_str(&saved).map_err(err)?
    };
    let cert = B64.decode(identity.cert).map_err(err)?;
    let pin = digest_hex(&cert);
    let key = PrivatePkcs8KeyDer::from(B64.decode(identity.key).map_err(err)?);
    let config =
        ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .map_err(err)?
            .with_no_client_auth()
            .with_single_cert(vec![CertificateDer::from(cert)], key.into())
            .map_err(err)?;
    Ok((config, pin))
}
fn notify(app: &AppHandle, event: &str, payload: impl Serialize) {
    if let Some(win) = app.get_webview_window("main") {
        if let Ok(json) = serde_json::to_string(&payload) {
            let _ = win.eval(format!("window.onVelunaNearby?.({event:?},{json})"));
        }
    }
}
fn reply(io: &mut impl Write, data: serde_json::Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(&data).map_err(err)?;
    io.write_all(&(bytes.len() as u32).to_be_bytes())
        .and_then(|_| io.write_all(&bytes))
        .and_then(|_| io.flush())
        .map_err(err)
}
fn filename(input: &str) -> Result<String, String> {
    let (stem, ext) = input
        .rsplit_once('.')
        .ok_or("Thiếu phần mở rộng file nhạc.")?;
    let ext = ext.to_ascii_lowercase();
    if !["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"].contains(&ext.as_str()) {
        return Err("Định dạng nhạc chưa được hỗ trợ.".into());
    }
    let clean: String = stem
        .chars()
        .filter(|c| c.is_alphanumeric() || " _-".contains(*c))
        .take(95)
        .collect();
    let clean = clean.trim();
    Ok(format!(
        "{}.{ext}",
        if clean.is_empty() {
            "Audio".to_owned()
        } else {
            format!("Music - {clean}")
        }
    ))
}
impl Receiver {
    fn persist(&self, peers: &HashMap<String, String>) -> Result<(), String> {
        let path = state_path(&self.app)?;
        let parent = path.parent().ok_or("Missing data directory")?;
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(err)?;
        serde_json::to_writer(&mut temp, peers).map_err(err)?;
        temp.persist(path).map_err(err)?;
        Ok(())
    }
    fn invitation(&self) -> Result<Invitation, String> {
        let link = format!(
            "veluna-pair://{}?pin={}&token={}",
            self.address, self.pin, self.token
        );
        let qr = qrcode::QrCode::new(link.as_bytes()).map_err(err)?;
        let grid = (0..qr.width())
            .map(|y| {
                (0..qr.width())
                    .map(|x| qr[(x, y)] == qrcode::Color::Dark)
                    .collect()
            })
            .collect();
        Ok(Invitation {
            link,
            qr: grid,
            address: self.address.to_string(),
        })
    }
    fn close(&self) {
        self.stop.store(true, Ordering::Release);
        if let Ok(mut d) = self.decision.lock() {
            if let Some((_, tx)) = d.take() {
                let _ = tx.try_send(false);
            }
        }
        if let Some(daemon) = &self.daemon {
            let _ = daemon.shutdown();
        }
        let _ = TcpStream::connect_timeout(&self.address, Duration::from_millis(400));
    }
    fn confirm(&self, phone: &str) -> Result<(), String> {
        let (tx, rx) = mpsc::sync_channel(1);
        let id = random()?;
        {
            let mut d = self.decision.lock().map_err(err)?;
            if d.is_some() {
                return Err("PC đang ghép đôi với thiết bị khác.".into());
            }
            *d = Some((id.clone(), tx));
        }
        notify(
            &self.app,
            "pair",
            serde_json::json!({"id":id,"device":phone}),
        );
        let allowed = rx.recv_timeout(Duration::from_secs(60)).unwrap_or(false);
        let mut d = self.decision.lock().map_err(err)?;
        if d.as_ref().is_some_and(|x| x.0 == id) {
            d.take();
        }
        if allowed && !self.stop.load(Ordering::Acquire) {
            Ok(())
        } else {
            Err("PC đã từ chối hoặc hết thời gian xác nhận.".into())
        }
    }
    fn connection(&self, stream: TcpStream) -> Result<(), String> {
        stream
            .set_read_timeout(Some(Duration::from_secs(30)))
            .map_err(err)?;
        stream
            .set_write_timeout(Some(Duration::from_secs(15)))
            .map_err(err)?;
        let conn = ServerConnection::new(self.tls.clone()).map_err(err)?;
        let mut io = StreamOwned::new(conn, stream);
        let mut length = [0; 4];
        io.read_exact(&mut length).map_err(err)?;
        let len = u32::from_be_bytes(length) as usize;
        if !(1..=8192).contains(&len) {
            return Err("Invalid header".into());
        }
        let mut bytes = vec![0; len];
        io.read_exact(&mut bytes).map_err(err)?;
        let header: Header = serde_json::from_slice(&bytes).map_err(err)?;
        match self.request(&mut io, header) {
            Ok(()) => Ok(()),
            Err(reason) => {
                let _ = reply(&mut io, serde_json::json!({"ok":false,"message":reason}));
                Err(reason)
            }
        }
    }
    fn request(&self, io: &mut (impl Read + Write), h: Header) -> Result<(), String> {
        if h.key.len() != 43 || B64.decode(&h.key).map_err(err)?.len() != 32 {
            return Err("Thiếu thông tin ghép đôi.".into());
        }
        let peer = digest_hex(h.key.as_bytes());
        if h.kind == "pair" {
            if self.created.elapsed() > Duration::from_secs(300) || h.token != self.token {
                return Err("Mã ghép đôi đã hết hạn.".into());
            }
            let name: String = h
                .device
                .chars()
                .filter(|c| !c.is_control())
                .take(64)
                .collect();
            if name.is_empty() {
                return Err("Thiếu tên thiết bị.".into());
            }
            self.confirm(&name)?;
            let mut peers = self.peers.lock().map_err(err)?;
            if self.stop.load(Ordering::Acquire) {
                return Err("PC đã dừng nhận.".into());
            }
            let mut changed = peers.clone();
            changed.insert(peer, name);
            self.persist(&changed)?;
            *peers = changed;
            notify(&self.app, "status", "Đã ghép đôi. PC có thể nhận nhạc.");
            return reply(io, serde_json::json!({"ok":true}));
        }
        if h.kind != "send" || !self.peers.lock().map_err(err)?.contains_key(&peer) {
            return Err("Thiết bị chưa được PC tin cậy.".into());
        }
        if h.size == 0
            || h.size > MAX_BYTES
            || h.digest.len() != 64
            || !h
                .digest
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err("Kích thước hoặc mã kiểm tra không hợp lệ.".into());
        }
        let name = filename(&h.name)?;
        let dir = self
            .app
            .path()
            .app_data_dir()
            .map_err(err)?
            .join("received")
            .join(&h.digest);
        fs::create_dir_all(&dir).map_err(err)?;
        let mut temp = tempfile::NamedTempFile::new_in(&dir).map_err(err)?;
        reply(io, serde_json::json!({"ok":true,"ready":true}))?;
        let mut sha = Sha256::new();
        let mut remaining = h.size;
        let mut buf = [0u8; 65536];
        let mut last = Instant::now();
        while remaining > 0 {
            if self.stop.load(Ordering::Acquire) {
                return Err("PC đã dừng nhận.".into());
            }
            let size = remaining.min(buf.len() as u64) as usize;
            let n = io.read(&mut buf[..size]).map_err(err)?;
            if n == 0 {
                return Err("Kết nối bị ngắt.".into());
            }
            sha.update(&buf[..n]);
            temp.write_all(&buf[..n]).map_err(err)?;
            remaining -= n as u64;
            if last.elapsed() > Duration::from_millis(400) {
                notify(
                    &self.app,
                    "progress",
                    ((h.size - remaining) * 100 / h.size) as u8,
                );
                last = Instant::now();
            }
        }
        if format!("{:x}", sha.finalize()) != h.digest {
            return Err("File nhận không khớp SHA-256.".into());
        }
        temp.flush().map_err(err)?;
        // Require a decodable local audio file before publishing it to the user's library.
        veluna_core::dj::analyze(temp.reopen().map_err(err)?)
            .map_err(|_| "Không đọc được nội dung âm thanh.".to_owned())?;
        let guard = self.peers.lock().map_err(err)?;
        if self.stop.load(Ordering::Acquire) || !guard.contains_key(&peer) {
            return Err("Quyền nhận đã bị thu hồi.".into());
        }
        let existing = fs::read_dir(&dir)
            .map_err(err)?
            .filter_map(Result::ok)
            .find(|entry| {
                let label = entry.file_name();
                let label = label.to_string_lossy();
                if !(label.starts_with("Music - ") || label.starts_with("Audio.")) {
                    return false;
                }
                let Ok(mut file) = fs::File::open(entry.path()) else {
                    return false;
                };
                let mut hash = Sha256::new();
                io::copy(&mut file, &mut hash).is_ok()
                    && format!("{:x}", hash.finalize()) == h.digest
            });
        let file = if let Some(entry) = existing {
            entry.path()
        } else {
            let mut p = dir.join(&name);
            if p.exists() {
                p = dir.join(format!("Music - {}-{name}", &random()?[..8]));
            }
            temp.persist_noclobber(&p).map_err(err)?;
            p
        };
        drop(guard);
        let (_, ids) = super::import_paths(&self.app, [file])?;
        let id = ids.first().ok_or("Không thêm được file.")?;
        notify(
            &self.app,
            "received",
            serde_json::json!({"id":id,"action":h.action}),
        );
        reply(io, serde_json::json!({"ok":true,"digest":h.digest}))
    }
}
#[tauri::command]
pub fn nearby_interfaces() -> Vec<String> {
    let mut ips: Vec<_> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match i.ip() {
            std::net::IpAddr::V4(v) if v.is_private() || v.is_link_local() => Some(v.to_string()),
            _ => None,
        })
        .collect();
    ips.sort();
    ips.dedup();
    ips
}
#[tauri::command]
pub fn nearby_start(
    app: AppHandle,
    state: tauri::State<Nearby>,
    ip: String,
) -> Result<Invitation, String> {
    if !nearby_interfaces().contains(&ip) {
        return Err("Chọn địa chỉ mạng LAN của PC.".into());
    }
    let mut slot = state.0.lock().map_err(err)?;
    if let Some(old) = slot.as_ref() {
        if old.address.ip().to_string() == ip && old.created.elapsed() < Duration::from_secs(300) {
            return old.invitation();
        }
        old.close();
    }
    let ip: Ipv4Addr = ip.parse().map_err(err)?;
    let listener = TcpListener::bind((ip, 44198))
        .or_else(|_| TcpListener::bind((ip, 0)))
        .map_err(err)?;
    let address = listener.local_addr().map_err(err)?;
    let (tls, pin) = tls_identity()?;
    let path = state_path(&app)?;
    let peers = if path.exists() {
        serde_json::from_slice(&fs::read(path).map_err(err)?).map_err(err)?
    } else {
        HashMap::new()
    };
    let daemon = mdns_sd::ServiceDaemon::new().ok().and_then(|daemon| {
        let instance = format!("VelunaMusic-{}", &pin[..10]);
        let host = format!("{instance}.local.");
        let properties = [("pin", pin.as_str())];
        let service = mdns_sd::ServiceInfo::new(
            SERVICE,
            &instance,
            &host,
            std::net::IpAddr::V4(ip),
            address.port(),
            &properties[..],
        )
        .ok()?;
        daemon.register(service).ok()?;
        Some(daemon)
    });
    let receiver = Arc::new(Receiver {
        stop: AtomicBool::new(false),
        sessions: AtomicUsize::new(0),
        address,
        token: random()?,
        created: Instant::now(),
        tls: Arc::new(tls),
        pin,
        decision: Mutex::default(),
        app,
        peers: Mutex::new(peers),
        daemon,
    });
    let invite = receiver.invitation()?;
    *slot = Some(receiver.clone());
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            if receiver.stop.load(Ordering::Acquire) {
                break;
            }
            let Ok(stream) = stream else { break };
            if !stream.peer_addr().is_ok_and(|addr|matches!(addr.ip(),std::net::IpAddr::V4(v) if v.is_private() || v.is_link_local())){continue;}
            if receiver.sessions.fetch_add(1, Ordering::AcqRel) >= 3 {
                receiver.sessions.fetch_sub(1, Ordering::AcqRel);
                continue;
            }
            let service = receiver.clone();
            std::thread::spawn(move || {
                let _ = service.connection(stream);
                service.sessions.fetch_sub(1, Ordering::AcqRel);
            });
        }
    });
    Ok(invite)
}
#[tauri::command]
pub fn nearby_decide(state: tauri::State<Nearby>, id: String, accept: bool) -> Result<(), String> {
    let slot = state.0.lock().map_err(err)?;
    let service = slot.as_ref().ok_or("PC đã dừng nhận.")?;
    let mut asking = service.decision.lock().map_err(err)?;
    if asking.as_ref().is_none_or(|r| r.0 != id) {
        return Err("Yêu cầu đã hết hạn.".into());
    }
    if let Some((_, tx)) = asking.take() {
        tx.try_send(accept).map_err(err)?;
    }
    Ok(())
}
#[tauri::command]
pub fn nearby_stop(state: tauri::State<Nearby>) -> Result<(), String> {
    if let Some(r) = state.0.lock().map_err(err)?.take() {
        r.close();
    }
    Ok(())
}
#[tauri::command]
pub fn nearby_forget(app: AppHandle, state: tauri::State<Nearby>) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(err)?;
    if let Some(r) = slot.take() {
        r.close();
        r.peers.lock().map_err(err)?.clear();
    }
    let path = state_path(&app)?;
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(err(e)),
    }
}
