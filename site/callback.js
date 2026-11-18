(() => {
  const params=new URLSearchParams(location.search);
  history.replaceState(null,"",location.pathname);
  const status=document.getElementById("return-status");
  const state=params.get("state"),code=params.get("code"),error=params.get("error");
  if(!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !(code || error) || (code && code.length>2048)){
    status.textContent="Mở mục Spotify trong ứng dụng VelunaMusic để bắt đầu liên kết.";return;
  }
  const target=new URL("velunamusic://spotify/callback");
  target.searchParams.set("state",state);
  if(error)target.searchParams.set("error","access_denied");else target.searchParams.set("code",code);
  const launch=document.getElementById("return-app");
  launch.href=target.href;launch.hidden=false;
  status.textContent=error?"Bạn đã dừng việc liên kết.":"Quay lại ứng dụng trên máy đã mở Spotify để hoàn tất liên kết.";
  const copy=document.getElementById("copy-return");copy.hidden=false;
  copy.onclick=async()=>{try{await navigator.clipboard.writeText(target.href);status.textContent="Đã sao chép. Dán vào mục Spotify trên thiết bị vừa đăng nhập.";}catch{status.textContent="Nhấn giữ hoặc bấm chuột phải vào nút quay lại để sao chép liên kết.";}};
})();
