(() => {
  const get = id => document.getElementById(id);
  const themeId = "00000000-0000-4000-8000-000000000001";
  const config = window.velunaCloud;
  const tell = message => {
    if (get("account-status")) get("account-status").textContent = message;
    if (get("connect-status") && get("connect-dialog")?.open) get("connect-status").textContent = message;
  };
  let auth = null, revision = 0, ready = false, refreshing = null, generation = 0;
  let registeredDevices = [], lanStatus = null;
  const handoff = accountHandoff({request, deviceId:() => device().device_id, tell, active:() => !!auth, user:()=>auth?.id});
  const spotify = spotifySettings({request,user:()=>auth?.id,perform});
  const collections = playlistLibrary(request);
  const remote = playerRemote({
    config,
    request,
    onHandoff:()=>handoff.wake(),
    onPeersChange:()=>{ updateDeviceIndicators(); if (get("connect-dialog")?.open) renderConnectSheet(); },
    session:()=>auth,
    device,
    refresh:()=>request("/auth/v1/user")
  });

  async function request(path, method = "GET", body, authenticated = true, headers = {}) {
    const session = auth;
    if (authenticated && !session) throw Error("Hãy đăng nhập để tiếp tục.");
    if (authenticated && Date.now() >= session.expires - 60000) {
      if (!refreshing) refreshing = (native?.accountSession ? nativeTransfer("accountSession") : request("/auth/v1/token?grant_type=refresh_token", "POST",
        {refresh_token: session.refresh}, false)).then(data => {
          if (auth !== session) throw Error("Phiên đăng nhập đã thay đổi.");
          remember(data);
          if (!native?.accountSession) return window.velunaVault.write("account", data.refresh_token);
        }).finally(() => { refreshing = null; });
      await refreshing;
    }
    if(authenticated && (!auth || auth.id!==session.id)) throw Error("Tài khoản đã đổi.");
    const opts = {method, headers: {apikey: config.publishableKey, ...headers}, signal: AbortSignal.timeout(15000)};
    if (authenticated) opts.headers.Authorization = "Bearer " + auth.access;
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    const response = await fetch(config.url + path, opts);
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      if (data?.code === "40001") throw Object.assign(Error("Dữ liệu trên máy khác đã đổi. Nhận phiên bản mới trước khi lưu tiếp."),{code:data.code});
      throw Error(data?.msg || data?.message || data?.error_description || "Supabase chưa xử lý được yêu cầu.");
    }
    return data;
  }
  function remember(s) {
    auth = { access:s.access_token, refresh:s.refresh_token, expires:s.expires_at ? s.expires_at*1000 : Date.now() + s.expires_in * 1000,
      id:s.user.id, email:s.user.email };
    collections.account(auth.id);
    collections.syncHistory?.();
    remote.update();
    updateDeviceIndicators();
  }
  function panels() {
    get("credentials").hidden = !!auth;
    get("signed-in").hidden = !auth;
    get("account-email").textContent = auth?.email || "";
    get("password").value = "";
    const initial = auth?.email ? auth.email.trim()[0].toUpperCase() : "V";
    const avatar = get("home-avatar");
    if (avatar) avatar.textContent = initial;
    const topAvatar = get("account-avatar-label");
    if (topAvatar) topAvatar.textContent = initial;
  }
  function device() {
    const key = "device-id";
    let id = localStorage.getItem(key);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(key,id); }
    const platform = window.VelunaAndroid ? "android" : "windows";
    const fallbackLabel = platform === "android" ? (native?.deviceName?.() || "Android") : "Windows PC";
    return { device_id:id, label:localStorage.getItem("device-label") || fallbackLabel, platform };
  }
  async function devices() {
    const local = device();
    await request("/rest/v1/veluna_devices?on_conflict=user_id,device_id", "POST", {
      ...local, last_seen:new Date().toISOString()
    }, true, {Prefer:"resolution=merge-duplicates"});
    const rows = await request("/rest/v1/veluna_devices?select=device_id,label,platform,last_seen&order=last_seen.desc");
    registeredDevices = Array.isArray(rows) ? rows : [];
    const list = get("account-devices"); list.replaceChildren();
    for (const d of registeredDevices) {
      const li = document.createElement("li");
      li.textContent = d.label + (d.device_id === local.device_id ? " · Máy này" : " · " + d.platform);
      if (d.device_id !== local.device_id) {
        const send = document.createElement("button");
        send.textContent = "Chuyển bài sang đây";
        send.onclick = () => perform(() => handoff.send(d.device_id)); li.append(send);
      }
      list.append(li);
    }
    updateDeviceIndicators();
    if (get("connect-dialog")?.open) renderConnectSheet();
  }
  function closeConnectDialog() {
    const dlg = get("connect-dialog");
    if (window.velunaUtils?.closeDialog) {
      window.velunaUtils.closeDialog(dlg);
      return;
    }
    if (dlg?.open) dlg.close();
  }
  function updateDeviceIndicators() {
    const local = device();
    const peers = remote.getPeers ? remote.getPeers() : [];
    const activePeer = remote.getActivePeer ? remote.getActivePeer() : null;
    const onlinePeers = peers.filter(p => !p.offline);
    const activeRemote = activePeer && !activePeer.offline && activePeer.playing;
    const labelText = activeRemote ? activePeer.label : local.label;
    const pillLabel = get("now-device-label");
    if (pillLabel) pillLabel.textContent = labelText;
    const pill = get("now-device-pill");
    if (pill) {
      pill.classList.toggle("is-remote", Boolean(activeRemote));
      pill.dataset.onlineCount = String(onlinePeers.length);
    }
    for (const id of ["connect-open", "mini-connect"]) {
      const btn = get(id);
      if (!btn) continue;
      btn.dataset.connected = String(onlinePeers.length > 0 || Boolean(window.velunaNearby?.isPaired?.()));
      btn.setAttribute("aria-label", onlinePeers.length > 0 ? "Thiết bị phát (" + onlinePeers.length + " đang trực tuyến)" : "Chọn thiết bị phát");
    }
  }
  function renderConnectSheet() {
    const dlg = get("connect-dialog");
    if (!dlg) return;
    const local = device();
    const peers = remote.getPeers ? remote.getPeers() : [];
    const peerMap = new Map(peers.map(p => [p.id, p]));
    const activePeer = remote.getActivePeer ? remote.getActivePeer() : null;
    const localPlaying = document.body.dataset.playing === "true";
    const localTitle = tracks.find(t => t.id === selected)?.title || "Chưa chọn bài";
    const activeBox = get("connect-active");
    if (activeBox) {
      activeBox.replaceChildren();
      const remotePlaying = activePeer && !activePeer.offline && activePeer.playing && !localPlaying;
      const eq = document.createElement("div");
      eq.className = "connect-eq" + ((localPlaying || remotePlaying) ? " is-playing" : "");
      eq.setAttribute("aria-hidden", "true");
      eq.innerHTML = "<span></span><span></span><span></span>";
      const meta = document.createElement("div");
      meta.className = "connect-active-meta";
      const heading = document.createElement("strong");
      heading.textContent = "Đang phát trên " + (remotePlaying ? activePeer.label : local.label);
      const sub = document.createElement("small");
      sub.textContent = remotePlaying ? (activePeer.title || "Thiết bị từ xa") : localTitle;
      meta.append(heading, sub);
      activeBox.append(eq, meta);
      if (remotePlaying) {
        const backBtn = document.createElement("button");
        backBtn.type = "button";
        backBtn.className = "connect-action-btn";
        backBtn.textContent = "Chuyển về máy này";
        backBtn.onclick = () => {
          remote.command("pause");
          if (selected) el("play")?.click();
        };
        activeBox.append(backBtn);
      }
    }
    const listenChk = get("connect-listen-toggle");
    if (listenChk && get("remote-listen")) {
      listenChk.checked = get("remote-listen").checked;
      listenChk.disabled = !auth;
    }
    const cloudList = get("connect-cloud-list");
    if (cloudList) {
      cloudList.replaceChildren();
      if (!auth) {
        const note = document.createElement("div");
        note.className = "connect-empty";
        const p = document.createElement("p");
        p.textContent = "Đăng nhập tài khoản VelunaMusic để phát nối tiếp & điều khiển giữa Android và Windows PC.";
        const loginBtn = document.createElement("button");
        loginBtn.type = "button";
        loginBtn.className = "connect-primary-btn";
        loginBtn.textContent = "Đăng nhập tài khoản";
        loginBtn.onclick = () => { closeConnectDialog(); get("account")?.click(); };
        note.append(p, loginBtn);
        cloudList.append(note);
      } else {
        const merged = new Map();
        for (const d of registeredDevices) {
          if (d.device_id === local.device_id) continue;
          merged.set(d.device_id, { id: d.device_id, label: d.label, platform: d.platform || "", online: false, peer: null });
        }
        for (const p of peers) {
          if (p.id === local.device_id) continue;
          const prev = merged.get(p.id) || { id: p.id, label: p.label, platform: p.platform || "", online: false, peer: null };
          merged.set(p.id, { ...prev, label: p.label || prev.label, platform: p.platform || prev.platform, online: !p.offline, peer: p });
        }
        if (!merged.size) {
          const empty = document.createElement("p");
          empty.className = "connect-hint";
          empty.textContent = "Chưa phát hiện thiết bị nào khác đăng nhập cùng tài khoản. Mở VelunaMusic trên máy kia và bật cho phép nhận phiên nghe.";
          cloudList.append(empty);
        } else {
          for (const item of merged.values()) {
            const card = document.createElement("div");
            card.className = "connect-device-card" + (item.online ? " is-online" : "") + (activePeer?.id === item.id ? " is-selected" : "");
            const mainBtn = document.createElement("button");
            mainBtn.type = "button";
            mainBtn.className = "connect-device-main";
            mainBtn.onclick = () => perform(() => handoff.send(item.id));
            const title = document.createElement("strong");
            title.textContent = item.label;
            const detail = document.createElement("small");
            const plat = item.platform === "android" ? "Android" : item.platform === "windows" ? "Windows PC" : "Thiết bị";
            const stateLabel = item.online
              ? (item.peer?.playing ? "Đang phát · " + (item.peer.title || "Nhạc") : "Trực tuyến · Bấm để chuyển phát")
              : "Ngoại tuyến · Chờ thiết bị mở lại";
            detail.textContent = plat + " · " + stateLabel;
            mainBtn.append(title, detail);
            card.append(mainBtn);
            if (item.peer && (item.online || item.peer.durable)) {
              const ctrlBtn = document.createElement("button");
              ctrlBtn.type = "button";
              ctrlBtn.className = "connect-action-btn";
              ctrlBtn.textContent = activePeer?.id === item.id ? "Đang chọn" : "Điều khiển";
              ctrlBtn.onclick = () => {
                remote.selectPeer(item.id);
                renderConnectSheet();
              };
              card.append(ctrlBtn);
            }
            cloudList.append(card);
          }
        }
      }
    }
    const lanList = get("connect-lan-list");
    if (lanList) {
      lanList.replaceChildren();
      const paired = window.velunaNearby?.isPaired?.();
      const dest = window.velunaNearby?.destination?.() || "";
      if (paired && dest) {
        const card = document.createElement("div");
        card.className = "connect-device-card is-online";
        const info = document.createElement("div");
        info.className = "connect-device-main";
        const title = document.createElement("strong");
        title.textContent = dest;
        const sub = document.createElement("small");
        sub.textContent = "LAN nội bộ đã ghép đôi · Truyền file cục bộ không cần YouTube Music";
        info.append(title, sub);
        const sendBtn = document.createElement("button");
        sendBtn.type = "button";
        sendBtn.className = "connect-action-btn";
        sendBtn.textContent = "Phát trên PC";
        sendBtn.disabled = !selected || String(selected).startsWith("ytmusic://");
        sendBtn.onclick = () => {
          closeConnectDialog();
          window.velunaNearby?.sendForHandoff?.(selected, "now");
        };
        card.append(info, sendBtn);
        lanList.append(card);
      } else if (lanStatus?.active) {
        const info = document.createElement("p");
        info.className = "connect-hint";
        info.textContent = "PC đang bật nhận nhạc LAN tại " + (lanStatus.address || "mạng nội bộ") + (lanStatus.peers?.length ? " (" + lanStatus.peers.length + " thiết bị đã ghép đôi)." : ".");
        lanList.append(info);
      }
      const pairBtn = document.createElement("button");
      pairBtn.type = "button";
      pairBtn.className = "connect-secondary-btn";
      pairBtn.textContent = paired ? "Quản lý ghép đôi LAN / QR" : "Ghép đôi LAN qua mã QR";
      pairBtn.onclick = () => { closeConnectDialog(); window.velunaNearby?.open?.(); };
      lanList.append(pairBtn);
    }
    const strip = get("connect-remote-strip");
    if (strip) {
      const peer = activePeer && peerMap.get(activePeer.id);
      strip.hidden = !peer;
      if (peer) {
        if (get("connect-remote-name")) get("connect-remote-name").textContent = peer.label + (peer.title ? " · " + peer.title : "");
        const vol = get("connect-remote-volume");
        if (vol && document.activeElement !== vol) vol.value = String(peer.volume ?? 100);
        const playBtn = get("connect-remote-play");
        if (playBtn) {
          playBtn.textContent = peer.playing ? "Tạm dừng" : "Phát";
          playBtn.dataset.remoteAction = peer.playing ? "pause" : "play";
        }
        const shufBtn = get("connect-remote-shuffle");
        if (shufBtn) shufBtn.setAttribute("aria-pressed", String(Boolean(peer.shuffle)));
        const repBtn = get("connect-remote-repeat");
        if (repBtn) repBtn.dataset.repeat = peer.repeat || "off";
      }
    }
  }
  async function openConnectDialog() {
    const dlg = get("connect-dialog");
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
    renderConnectSheet();
    remote.update();
    if (auth) {
      handoff.open();
      perform(devices);
    }
    if (window.velunaNearby?.getLanInfo) {
      lanStatus = await window.velunaNearby.getLanInfo().catch(() => null);
      if (dlg.open) renderConnectSheet();
    }
  }
  async function theme(apply) {
    const rows = await request("/rest/v1/veluna_library?kind=eq.theme&item_id=eq." + themeId + "&select=revision,payload,deleted");
    const item = rows[0];
    revision = item?.revision || 0; ready = true;
    if (apply && item && !item.deleted && /^#[a-f\d]{6}$/i.test(item.payload.accent)) {
      const color = get("color"); color.value = item.payload.accent; color.dispatchEvent(new Event("input"));
      if(item.payload.glass)window.velunaTheme.apply(item.payload.glass);
      tell("Đã nhận giao diện từ tài khoản.");
    } else if (apply) tell("Tài khoản chưa lưu giao diện.");
  }
  async function perform(action) {
    const current = generation;
    for (const b of get("cloud-actions").querySelectorAll("button")) b.disabled = true;
    try { await action(); } catch (e) { if (current === generation) tell(e.message); }
    finally { for (const b of get("cloud-actions").querySelectorAll("button")) b.disabled = false; }
  }
  get("account").onclick = () => {
    panels(); get("account-dialog").showModal();
    if (auth) {handoff.open();remote.update();perform(spotify.show);}
    if (!config.url || !config.publishableKey) {
      tell("Bản thử nghiệm này chưa được kết nối với project Supabase.");
      get("credentials").hidden = true;
    }
  };
  get("close-account").onclick = () => get("account-dialog").close();
  get("account-dialog").addEventListener("close", () => {handoff.close();remote.update();});
  for (const triggerId of ["connect-open", "mini-connect", "now-device-pill"]) {
    const trigger = get(triggerId);
    if (trigger) trigger.onclick = () => openConnectDialog();
  }
  if (get("connect-close")) get("connect-close").onclick = closeConnectDialog;
  const connectDlg = get("connect-dialog");
  if (connectDlg) {
    connectDlg.addEventListener("close", () => { handoff.close(); remote.update(); updateDeviceIndicators(); });
    if (typeof HTMLDialogElement !== "undefined" && !("closedBy" in HTMLDialogElement.prototype)) {
      connectDlg.addEventListener("click", event => {
        if (event.target !== connectDlg) return;
        const rect = connectDlg.getBoundingClientRect();
        const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
        if (outside) closeConnectDialog();
      });
    }
  }
  if (get("connect-listen-toggle")) {
    get("connect-listen-toggle").onchange = e => {
      const opt = get("remote-listen");
      if (!opt) return;
      opt.checked = e.target.checked;
      opt.onchange?.();
    };
  }
  if (get("connect-refresh")) get("connect-refresh").onclick = () => { remote.update(); if (auth) perform(devices); };
  if (get("connect-remote-prev")) get("connect-remote-prev").onclick = () => remote.command("previous");
  if (get("connect-remote-play")) get("connect-remote-play").onclick = e => remote.command(e.currentTarget.dataset.remoteAction || "play");
  if (get("connect-remote-next")) get("connect-remote-next").onclick = () => remote.command("next");
  if (get("connect-remote-shuffle")) get("connect-remote-shuffle").onclick = () => {
    const peer = remote.getActivePeer?.();
    remote.command("shuffle", peer?.shuffle ? 0 : 1);
  };
  if (get("connect-remote-repeat")) get("connect-remote-repeat").onclick = () => {
    const peer = remote.getActivePeer?.();
    const cur = peer?.repeat || "off";
    const nextCode = cur === "off" ? 2 : cur === "all" ? 1 : 0;
    remote.command("repeat", nextCode);
  };
  if (get("connect-remote-volume")) get("connect-remote-volume").onchange = e => remote.command("volume", Number(e.target.value));
  window.addEventListener("veluna-nearby-change", () => { updateDeviceIndicators(); if (connectDlg?.open) renderConnectSheet(); });
  window.addEventListener("veluna-playback", () => { updateDeviceIndicators(); if (connectDlg?.open) renderConnectSheet(); });
  window.addEventListener("veluna-library", () => { if (connectDlg?.open) renderConnectSheet(); });
  window.velunaConnect = { open: openConnectDialog, close: closeConnectDialog, refresh: renderConnectSheet };
  get("login-form").onsubmit = e => { e.preventDefault(); const signup = e.submitter?.id === "signup";
    perform(async () => {
      const data = await request(signup ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password", "POST",
        {email:get("email").value.trim(),password:get("password").value}, false);
      get("password").value = "";
      if (!data.access_token) { tell("Kiểm tra email để xác nhận tài khoản rồi đăng nhập."); return; }
      await window.velunaVault.write("account", data.refresh_token);
      remember(data); revision = 0; ready = false; panels(); tell("Đã đăng nhập.");
      await devices(); await theme(false); handoff.open(); await spotify.show();
    });
  };
  get("refresh-devices").onclick = () => perform(devices);
  get("pull-theme").onclick = () => perform(() => theme(true));
  get("push-theme").onclick = () => perform(async () => {
    if (!ready) { await theme(true); return; }
    revision = await request("/rest/v1/rpc/veluna_save_item", "POST", {
      p_kind:"theme",p_item_id:themeId,p_expected_revision:revision,p_payload:{accent:get("color").value,glass:window.velunaTheme.export()},p_deleted:false
    }); tell("Đã lưu giao diện lên tài khoản.");
  });
  get("logout").onclick = () => perform(async () => {
    try { await request("/auth/v1/logout?scope=local", "POST"); }
    finally { handoff.clear(); auth = null; registeredDevices = []; collections.account(null); remote.update(); revision = 0; ready = false; generation++; await window.velunaVault.write("account", ""); panels(); await spotify.clear(); updateDeviceIndicators(); tell("Đã đăng xuất khỏi ứng dụng."); }
  });
  async function restore() {
    const token = await window.velunaVault.read("account");
    if (!token || auth) return;
    const data = native?.accountSession ? await nativeTransfer("accountSession") : await request("/auth/v1/token?grant_type=refresh_token", "POST", {refresh_token:token}, false);
    if (auth) return;
    if (!native?.accountSession) await window.velunaVault.write("account", data.refresh_token);
    remember(data); panels(); await devices(); await theme(false); await spotify.show();
  }
  updateDeviceIndicators();
  if (config.url && (window.VelunaAndroid || window.__TAURI__)) perform(restore);
})();
