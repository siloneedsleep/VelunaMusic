(() => {
  const id=new URLSearchParams(location.search).get("v");
  const status=document.getElementById("video-status"),root=document.getElementById("video-frame");
  if(!/^[a-zA-Z0-9_-]{11}$/.test(id || "")){status.textContent="Mở một liên kết video từ thư viện VelunaMusic.";return;}
  const link=document.getElementById("video-original");link.href="https://www.youtube.com/watch?v="+id;link.hidden=false;
  function show(){
    if(document.hidden || root.childElementCount)return;
    const frame=document.createElement("iframe");frame.title="Trình phát YouTube";
    frame.referrerPolicy="strict-origin-when-cross-origin";frame.allow="encrypted-media; fullscreen; picture-in-picture";
    frame.src="https://www.youtube-nocookie.com/embed/"+id+"?playsinline=1&origin="+encodeURIComponent(location.origin);
    frame.allowFullscreen=true;root.append(frame);status.textContent="Phát và chọn chất lượng bằng điều khiển YouTube.";
  }
  document.addEventListener("visibilitychange",()=>{if(document.hidden)root.replaceChildren();else show();});show();
})();
