"use strict";

(() => {
  const root = typeof window !== "undefined" ? window : globalThis;

  function byId(id) {
    if (typeof el === "function") return el(id);
    return typeof document !== "undefined" ? document.getElementById(id) : null;
  }

  function formatTime(sec) {
    return Number.isFinite(sec)
      ? Math.floor(sec / 60) + ":" + String(Math.floor(sec % 60)).padStart(2, "0")
      : "0:00";
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLocaleLowerCase()
      .trim();
  }

  function debounce(fn, delayMs = 350) {
    let timer = 0;
    const call = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = 0;
        fn(...args);
      }, delayMs);
    };
    const cancel = () => {
      clearTimeout(timer);
      timer = 0;
    };
    return { call, cancel };
  }

  function applyCoverFallback(img, src, fallback = "icon.png") {
    if (!img) return img;
    img.src = src || fallback;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.onerror = () => {
      if (img.src !== fallback) img.src = fallback;
    };
    return img;
  }

  function videoId(value) {
    if (typeof value !== "string") return "";
    if (value.startsWith("ytmusic://")) {
      const bare = value.slice("ytmusic://".length);
      return /^[\w-]{11}$/.test(bare) ? bare : "";
    }
    const trimmed = value.trim();
    if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
    let url;
    try { url = new URL(value); } catch { return ""; }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    let id = "";
    if (url.hostname === "youtu.be") id = url.pathname.slice(1);
    else if (["youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com"].includes(url.hostname)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else if (/^\/(shorts|live)\/[\w-]{11}$/.test(url.pathname)) id = url.pathname.split("/")[2];
    }
    return /^[\w-]{11}$/.test(id || "") ? id : "";
  }

  function isDummyTrack(track) {
    return /^(?:Veluna QA|Veluna LAN test)\b/i.test(String(track?.title || ""));
  }

  function createTrackCard({
    title,
    subtitle,
    duration,
    coverUrl,
    sourceBadgeText,
    variantText,
    isOffline = false,
    onPlay,
    onQueue,
    queueLabel = "+ Hàng chờ",
    onDownload,
    downloadLabel
  }) {
    const row = document.createElement("div");
    row.className = "search-row";

    const mainBtn = document.createElement("button");
    mainBtn.type = "button";
    mainBtn.className = "search-row-main";
    mainBtn.onclick = onPlay;

    const img = document.createElement("img");
    img.className = "search-row-thumb";
    applyCoverFallback(img, coverUrl);

    const info = document.createElement("span");
    info.className = "search-row-info";
    const nameEl = document.createElement("strong");
    nameEl.textContent = title;
    const subEl = document.createElement("small");
    subEl.textContent = [subtitle, duration].filter(Boolean).join(" · ");

    const badges = document.createElement("span");
    badges.className = "search-row-badges";
    if (sourceBadgeText) {
      const b = document.createElement("span");
      b.className = sourceBadgeText.includes("YT Music") ? "source-chip is-ytm" : "source-chip is-local";
      b.textContent = sourceBadgeText;
      badges.append(b);
    }
    if (isOffline) {
      const off = document.createElement("span");
      off.className = "source-chip is-offline";
      off.textContent = "Đã tải về";
      badges.append(off);
    }
    if (variantText) {
      const v = document.createElement("span");
      v.className = "source-chip is-variant";
      v.textContent = variantText;
      badges.append(v);
    }
    info.append(nameEl, subEl, badges);
    mainBtn.append(img, info);
    row.append(mainBtn);

    if (onDownload) {
      const dBtn = document.createElement("button");
      dBtn.type = "button";
      dBtn.className = isOffline ? "search-row-action is-offline-remove" : "search-row-action";
      const labelText = downloadLabel || (isOffline ? "Xóa tải về" : "Tải về");
      dBtn.textContent = labelText;
      dBtn.setAttribute("aria-label", labelText + ": " + title);
      dBtn.onclick = onDownload;
      row.append(dBtn);
    }

    if (onQueue) {
      const qBtn = document.createElement("button");
      qBtn.type = "button";
      qBtn.className = "search-row-action";
      qBtn.textContent = queueLabel;
      qBtn.setAttribute("aria-label", queueLabel + ": " + title);
      qBtn.onclick = onQueue;
      row.append(qBtn);
    }
    return { row, img };
  }

  function canTransitionTopLayer() {
    return typeof CSS !== "undefined"
      && typeof CSS.supports === "function"
      && CSS.supports("transition-behavior", "allow-discrete")
      && CSS.supports("transition-property", "overlay");
  }

  function openDialog(dialog) {
    if (!dialog || dialog.open || typeof dialog.showModal !== "function") return;
    dialog.showModal();
  }

  function closeDialog(dialog) {
    if (!dialog || !dialog.open) return;
    if (canTransitionTopLayer() || document?.body?.dataset?.motion === "off") {
      dialog.close();
      return;
    }
    dialog.dataset.closing = "true";
    const animations = typeof dialog.getAnimations === "function" ? dialog.getAnimations() : [];
    if (!animations.length) {
      delete dialog.dataset.closing;
      dialog.close();
      return;
    }
    Promise.allSettled(animations.map(a => a.finished)).then(() => {
      delete dialog.dataset.closing;
      if (dialog.open) dialog.close();
    });
  }

  function bindLightDismiss(dialog) {
    if (!dialog || typeof dialog.addEventListener !== "function") return;
    const supportsClosedBy = typeof HTMLDialogElement !== "undefined" && "closedBy" in HTMLDialogElement.prototype;
    if (!supportsClosedBy) {
      dialog.addEventListener("click", event => {
        if (event.target === dialog) closeDialog(dialog);
      });
    }
  }

  function callBridge({ nativeMethod, tauriCommand, desktopArgs = {}, nativeArgs = [], fallbackError = "Backend chưa sẵn sàng trên thiết bị này." }) {
    const androidBridge = typeof native !== "undefined" ? native : root.VelunaAndroid;
    if (androidBridge && nativeMethod && typeof androidBridge[nativeMethod] === "function") {
      if (typeof nativeTransfer === "function") return nativeTransfer(nativeMethod, ...nativeArgs);
      try {
        const raw = androidBridge[nativeMethod](...nativeArgs);
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed?.error) return Promise.reject(Error(parsed.error));
        return Promise.resolve(parsed);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    const tauriBridge = typeof desktop !== "undefined" ? desktop : root.__TAURI__?.core;
    if (tauriBridge && tauriCommand && typeof tauriBridge.invoke === "function") {
      return tauriBridge.invoke(tauriCommand, desktopArgs);
    }
    return Promise.reject(Error(fallbackError));
  }

  root.velunaUtils = {
    byId,
    formatTime,
    normalizeSearchText,
    debounce,
    applyCoverFallback,
    videoId,
    isDummyTrack,
    createTrackCard,
    openDialog,
    closeDialog,
    bindLightDismiss,
    callBridge
  };
})();
