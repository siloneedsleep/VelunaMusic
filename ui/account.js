(() => {
  const get = id => document.getElementById(id);
  const themeId = "00000000-0000-4000-8000-000000000001";
  const config = window.velunaCloud;
  const tell = message => { get("account-status").textContent = message; };
  let auth = null, revision = 0, ready = false, refreshing = null, generation = 0;
  const handoff = accountHandoff({request, deviceId:() => device().device_id, tell, active:() => !!auth});

  async function request(path, method = "GET", body, authenticated = true, headers = {}) {
    const session = auth;
    if (authenticated && !session) throw Error("Hãy đăng nhập để tiếp tục.");
    if (authenticated && Date.now() >= session.expires - 60000) {
      if (!refreshing) refreshing = request("/auth/v1/token?grant_type=refresh_token", "POST",
        {refresh_token: session.refresh}, false).then(data => {
          if (auth !== session) throw Error("Phiên đăng nhập đã thay đổi.");
          remember(data);
          return window.velunaVault.write("account", data.refresh_token);
        }).finally(() => { refreshing = null; });
      await refreshing;
    }
    const opts = {method, headers: {apikey: config.publishableKey, ...headers}, signal: AbortSignal.timeout(15000)};
    if (authenticated) opts.headers.Authorization = "Bearer " + auth.access;
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    const response = await fetch(config.url + path, opts);
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      if (data?.code === "40001") throw Error("Màu trên máy khác đã thay đổi. Hãy nhận màu từ tài khoản trước khi lưu tiếp.");
      throw Error(data?.msg || data?.message || data?.error_description || "Supabase chưa xử lý được yêu cầu.");
    }
    return data;
  }
  function remember(s) {
    auth = { access:s.access_token, refresh:s.refresh_token, expires:Date.now() + s.expires_in * 1000,
      id:s.user.id, email:s.user.email };
  }
  function panels() {
    get("credentials").hidden = !!auth;
    get("signed-in").hidden = !auth;
    get("account-email").textContent = auth?.email || "";
    get("password").value = "";
  }
  function device() {
    const key = "device-id";
    let id = localStorage.getItem(key);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(key,id); }
    const platform = window.VelunaAndroid ? "android" : "windows";
    return { device_id:id, label:localStorage.getItem("device-label") || (platform === "android" ? "Android" : "Windows PC"), platform };
  }
  async function devices() {
    const local = device();
    await request("/rest/v1/veluna_devices?on_conflict=user_id,device_id", "POST", {
      ...local, last_seen:new Date().toISOString()
    }, true, {Prefer:"resolution=merge-duplicates"});
    const rows = await request("/rest/v1/veluna_devices?select=device_id,label,platform,last_seen&order=last_seen.desc");
    const list = get("account-devices"); list.replaceChildren();
    for (const d of rows) {
      const li = document.createElement("li");
      li.textContent = d.label + (d.device_id === local.device_id ? " · Máy này" : " · " + d.platform);
      if (d.device_id !== local.device_id) {
        const send = document.createElement("button");
        send.textContent = "Chuyển bài sang đây";
        send.onclick = () => perform(() => handoff.send(d.device_id)); li.append(send);
      }
      list.append(li);
    }
  }
  async function theme(apply) {
    const rows = await request("/rest/v1/veluna_library?kind=eq.theme&item_id=eq." + themeId + "&select=revision,payload,deleted");
    const item = rows[0];
    revision = item?.revision || 0; ready = true;
    if (apply && item && !item.deleted && /^#[a-f\d]{6}$/i.test(item.payload.accent)) {
      const color = get("color"); color.value = item.payload.accent; color.dispatchEvent(new Event("input")); tell("Đã nhận màu nhấn từ tài khoản.");
    } else if (apply) tell("Tài khoản chưa lưu màu nhấn.");
  }
  async function perform(action) {
    const current = generation;
    for (const b of get("cloud-actions").querySelectorAll("button")) b.disabled = true;
    try { await action(); } catch (e) { if (current === generation) tell(e.message); }
    finally { for (const b of get("cloud-actions").querySelectorAll("button")) b.disabled = false; }
  }
  get("account").onclick = () => {
    panels(); get("account-dialog").showModal();
    if (auth) handoff.open();
    if (!config.url || !config.publishableKey) {
      tell("Bản thử nghiệm này chưa được kết nối với project Supabase.");
      get("credentials").hidden = true;
    }
  };
  get("close-account").onclick = () => get("account-dialog").close();
  get("account-dialog").addEventListener("close", () => handoff.close());
  get("login-form").onsubmit = e => { e.preventDefault(); const signup = e.submitter?.id === "signup";
    perform(async () => {
      const data = await request(signup ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password", "POST",
        {email:get("email").value.trim(),password:get("password").value}, false);
      get("password").value = "";
      if (!data.access_token) { tell("Kiểm tra email để xác nhận tài khoản rồi đăng nhập."); return; }
      await window.velunaVault.write("account", data.refresh_token);
      remember(data); revision = 0; ready = false; panels(); tell("Đã đăng nhập.");
      await devices(); await theme(false); handoff.open();
    });
  };
  get("refresh-devices").onclick = () => perform(devices);
  get("pull-theme").onclick = () => perform(() => theme(true));
  get("push-theme").onclick = () => perform(async () => {
    if (!ready) { await theme(true); return; }
    revision = await request("/rest/v1/rpc/veluna_save_item", "POST", {
      p_kind:"theme",p_item_id:themeId,p_expected_revision:revision,p_payload:{accent:get("color").value},p_deleted:false
    }); tell("Đã lưu màu nhấn lên tài khoản.");
  });
  get("logout").onclick = () => perform(async () => {
    try { await request("/auth/v1/logout?scope=local", "POST"); }
    finally { handoff.clear(); auth = null; revision = 0; ready = false; generation++; await window.velunaVault.write("account", ""); panels(); tell("Đã đăng xuất khỏi ứng dụng."); }
  });
  async function restore() {
    const token = await window.velunaVault.read("account");
    if (!token || auth) return;
    const data = await request("/auth/v1/token?grant_type=refresh_token", "POST", {refresh_token:token}, false);
    if (auth) return;
    await window.velunaVault.write("account", data.refresh_token);
    remember(data); panels(); await devices(); await theme(false);
  }
  if (config.url && (window.VelunaAndroid || window.__TAURI__)) perform(restore);
})();
