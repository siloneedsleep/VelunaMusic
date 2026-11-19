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
    destination: Box<dyn Destination>,
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
#[derive(Serialize)]
pub struct NearbyStatus {
    pub active: bool,
    pub address: String,
    pub peers: Vec<String>,
}
#[derive(Deserialize)]
struct Header {
    kind: String,
    #[serde(default)]
    video_id: String,
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
    server_identity(identity)
}
fn server_identity(identity: Identity) -> Result<(ServerConfig, String), String> {
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
trait Destination: Send + Sync {
    fn data_dir(&self) -> Result<std::path::PathBuf, String>;
    fn import(&self, file: std::path::PathBuf) -> Result<String, String>;
    fn reference(&self, video_id: &str, title: String) -> Result<(), String>;
    fn event(&self, event: &str, payload: serde_json::Value);
}
impl Destination for AppHandle {
    fn data_dir(&self) -> Result<std::path::PathBuf, String> {
        self.path().app_data_dir().map_err(err)
    }
    fn import(&self, file: std::path::PathBuf) -> Result<String, String> {
        let (_, ids) = super::import_paths(self, [file])?;
        ids.into_iter()
            .next()
            .ok_or_else(|| "Không thêm được file.".to_owned())
    }
    fn reference(&self, video_id: &str, title: String) -> Result<(), String> {
        super::save_references(
            self,
            vec![super::Track {
                id: format!("ytmusic://{video_id}"),
                title,
            }],
        )
    }
    fn event(&self, event: &str, payload: serde_json::Value) {
        if let Some(win) = self.get_webview_window("main") {
            let _ = win.eval(format!("window.onVelunaNearby?.({event:?},{payload})"));
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
        let path = self.destination.data_dir()?.join("nearby-peers.json");
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
        self.destination
            .event("pair", serde_json::json!({"id":id,"device":phone}));
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
            self.destination
                .event("status", "Đã ghép đôi. PC có thể nhận nhạc.".into());
            return reply(io, serde_json::json!({"ok":true}));
        }
        if !matches!(h.kind.as_str(), "send" | "reference")
            || !self.peers.lock().map_err(err)?.contains_key(&peer)
        {
            return Err("Thiết bị chưa được PC tin cậy.".into());
        }
        if !matches!(h.action.as_str(), "save" | "next" | "now" | "end") {
            return Err("Invalid queue action".into());
        }
        if h.kind == "reference" {
            if !veluna_core::ytmusic::valid_video_id(&h.video_id)
                || h.name.is_empty()
                || h.name.chars().count() > 512
            {
                return Err("Invalid music reference".into());
            }
            self.destination.reference(&h.video_id, h.name)?;
            self.destination.event(
                "received",
                serde_json::json!({"id":format!("ytmusic://{}",h.video_id),"action":h.action}),
            );
            return reply(io, serde_json::json!({"ok":true}));
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
            .destination
            .data_dir()?
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
                self.destination.event(
                    "progress",
                    (((h.size - remaining) * 100 / h.size) as u8).into(),
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
        let id = self.destination.import(file)?;
        self.destination
            .event("received", serde_json::json!({"id":id,"action":h.action}));
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
    // UDP connect asks the OS which interface it would route through. It sends no payload.
    let preferred = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .ok()
        .and_then(|s| {
            s.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
            Some(s.local_addr().ok()?.ip().to_string())
        });
    if let Some(index) = preferred.and_then(|ip| ips.iter().position(|item| item == &ip)) {
        ips.swap(0, index);
    }
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
        destination: Box::new(app),
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
pub fn nearby_status(app: AppHandle, state: tauri::State<Nearby>) -> Result<NearbyStatus, String> {
    let slot = state.0.lock().map_err(err)?;
    if let Some(r) = slot.as_ref() {
        let peers: Vec<String> = r.peers.lock().map_err(err)?.values().cloned().collect();
        return Ok(NearbyStatus {
            active: true,
            address: r.address.to_string(),
            peers,
        });
    }
    let path = state_path(&app)?;
    let peers: Vec<String> = if path.exists() {
        serde_json::from_slice::<HashMap<String, String>>(&fs::read(path).map_err(err)?)
            .map(|m| m.into_values().collect())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    Ok(NearbyStatus {
        active: false,
        address: String::new(),
        peers,
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use rustls::{ClientConfig, ClientConnection, RootCertStore};
    use serde_json::{json, Value};
    use std::path::PathBuf;

    struct Library {
        dir: PathBuf,
        events: mpsc::Sender<(String, Value)>,
    }
    impl Destination for Library {
        fn data_dir(&self) -> Result<PathBuf, String> {
            Ok(self.dir.clone())
        }
        fn import(&self, file: PathBuf) -> Result<String, String> {
            Ok(file.to_string_lossy().into_owned())
        }
        fn reference(&self, video_id: &str, title: String) -> Result<(), String> {
            fs::write(self.dir.join(video_id), title).map_err(err)
        }
        fn event(&self, event: &str, value: Value) {
            self.events.send((event.to_owned(), value)).unwrap();
        }
    }
    fn read_frame(input: &mut impl Read) -> Value {
        let mut size = [0; 4];
        input.read_exact(&mut size).unwrap();
        let mut message = vec![0; u32::from_be_bytes(size) as usize];
        input.read_exact(&mut message).unwrap();
        serde_json::from_slice(&message).unwrap()
    }
    fn wave() -> Vec<u8> {
        let mut out = b"RIFF".to_vec();
        let size = 16000u32;
        out.extend((size + 36).to_le_bytes());
        out.extend(b"WAVEfmt ");
        out.extend(16u32.to_le_bytes());
        for n in [1u16, 1] {
            out.extend(n.to_le_bytes());
        }
        for n in [8000u32, 16000] {
            out.extend(n.to_le_bytes());
        }
        for n in [2u16, 16] {
            out.extend(n.to_le_bytes());
        }
        out.extend(b"data");
        out.extend(size.to_le_bytes());
        out.resize(44 + size as usize, 0);
        out
    }
    #[test]
    fn nearby_pairs_over_tls_and_imports_complete_audio_once() {
        let temp = tempfile::tempdir().unwrap();
        let (events, incoming) = mpsc::channel();
        let generated =
            rcgen::generate_simple_self_signed(vec!["velunamusic.local".into()]).unwrap();
        let mut trust = RootCertStore::empty();
        trust.add(generated.cert.der().clone()).unwrap();
        let (tls, pin) = server_identity(Identity {
            cert: B64.encode(generated.cert.der()),
            key: B64.encode(generated.key_pair.serialize_der()),
        })
        .unwrap();
        let client = Arc::new(
            ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                .with_safe_default_protocol_versions()
                .unwrap()
                .with_root_certificates(trust)
                .with_no_client_auth(),
        );
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let key = random().unwrap();
        let server = Arc::new(Receiver {
            stop: false.into(),
            sessions: 0.into(),
            address,
            token: random().unwrap(),
            created: Instant::now(),
            tls: Arc::new(tls),
            pin,
            decision: Mutex::default(),
            peers: Mutex::default(),
            daemon: None,
            destination: Box::new(Library {
                dir: temp.path().to_owned(),
                events,
            }),
        });
        let worker = Arc::clone(&server);
        let thread = std::thread::spawn(move || {
            for _ in 0..6 {
                let (stream, _) = listener.accept().unwrap();
                let _ = worker.connection(stream);
            }
        });
        let connect = || {
            let socket = TcpStream::connect(address).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(8)))
                .unwrap();
            StreamOwned::new(
                ClientConnection::new(client.clone(), "velunamusic.local".try_into().unwrap())
                    .unwrap(),
                socket,
            )
        };
        let mut pair = connect();
        reply(
            &mut pair,
            json!({"kind":"pair","key":key,"token":server.token,"device":"Fixture phone"}),
        )
        .unwrap();
        let (event, request) = incoming.recv_timeout(Duration::from_secs(8)).unwrap();
        assert_eq!(event, "pair");
        let (id, decision) = server.decision.lock().unwrap().take().unwrap();
        assert_eq!(id, request["id"]);
        decision.send(true).unwrap();
        assert_eq!(read_frame(&mut pair)["ok"], true);
        let saved = fs::read_to_string(temp.path().join("nearby-peers.json")).unwrap();
        assert!(saved.contains(&digest_hex(key.as_bytes())) && !saved.contains(&key));
        let audio = wave();
        let digest = digest_hex(&audio);
        let send = |hash: &str| {
            let mut link = connect();
            reply(&mut link,json!({"kind":"send","key":key,"size":audio.len(),"digest":hash,"name":"Demo.wav","action":"save"})).unwrap();
            assert_eq!(read_frame(&mut link)["ready"], true);
            link.write_all(&audio).unwrap();
            link.flush().unwrap();
            read_frame(&mut link)
        };
        assert_eq!(send(&"0".repeat(64))["ok"], false);
        assert_eq!(send(&digest)["digest"], digest);
        assert_eq!(send(&digest)["digest"], digest);
        for (video, ok) in [("abcdefghijk", true), ("../bad-path", false)] {
            let mut link = connect();
            reply(&mut link,json!({"kind":"reference","key":key,"video_id":video,"name":"Fixture","action":"end"})).unwrap();
            assert_eq!(read_frame(&mut link)["ok"], ok);
        }
        assert_eq!(
            fs::read_to_string(temp.path().join("abcdefghijk")).unwrap(),
            "Fixture"
        );
        thread.join().unwrap();
        let paths = fs::read_dir(temp.path().join("received").join(&digest))
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect::<Vec<_>>();
        assert_eq!(paths.len(), 1);
        assert_eq!(fs::read(&paths[0]).unwrap(), audio);
    }
}
