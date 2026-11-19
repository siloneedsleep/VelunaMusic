const names = { windows: "VelunaMusic-Windows-x64.exe", android: "VelunaMusic-Android.apk" };
const repo = "siloneedsleep/VelunaMusic";
const status = document.getElementById("status");
const url = "https://api.github.com/repos/" + repo + "/releases/latest";
let display="checking", version="";
function renderStatus(){
  const en=document.documentElement?.lang==="en";
  if(display==="error"){
    status.replaceChildren(en?"Download status unavailable. ":"Chưa kiểm tra được bản tải. ");
    const link=document.createElement("a");link.href="https://github.com/"+repo+"/releases";
    link.textContent=en?"Check GitHub ↗":"Kiểm tra trên GitHub ↗";status.append(link);return;
  }
  status.textContent=display==="ready"?version+(en?" · Latest stable release on GitHub":" · Bản chính thức mới nhất trên GitHub"):
    display==="unreleased"?(en?"In development. Downloads open with the first stable release.":"Đang phát triển. Bản tải sẽ mở khi bản phát hành đầu tiên sẵn sàng."):
    (en?"Checking GitHub Releases…":"Đang kiểm tra GitHub Releases…");
}
document.addEventListener?.("veluna-language",renderStatus);
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (res.status === 404) {
    display="unreleased";
  } else {
    if (!res.ok) throw Error("release lookup");
    const release = await res.json();
    if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw Error("release format");
    const prefix = "https://github.com/" + repo + "/releases/download/" + release.tag_name + "/";
    const assets = Object.entries(names).map(([id,name]) => {
      const asset = release.assets.find(a => a.name === name && a.state === "uploaded" && a.size > 0 && a.browser_download_url === prefix + name);
      if (!asset) throw Error("release incomplete");
      return [id, asset];
    });
    for (const [id,asset] of assets) {
      const link = document.getElementById(id);
      link.href = asset.browser_download_url;
      link.removeAttribute("aria-disabled");
    }
    display="ready";version=release.tag_name;
  }
} catch {display="error";}
renderStatus();
