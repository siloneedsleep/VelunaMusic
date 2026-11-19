"use strict";

(() => {
  const bands = ["bass", "mid", "high"];
  const profiles = ["speaker", "headphones", "bluetooth"];
  let selectedProfile = localStorage.getItem("sound-profile") || "speaker";
  let opts = {};
  if (!profiles.includes(selectedProfile)) selectedProfile = "speaker";
  const status = s => {
    const node = el("sound-status");
    if (node) node.textContent = s;
  };

  function read() {
    let v = {};
    try { v = JSON.parse(localStorage.getItem("sound/" + selectedProfile)) || {}; } catch {}
    opts = { enabled: v.enabled === true };
    for (const band of bands) {
      opts[band] = Number.isFinite(v[band]) ? Math.min(6, Math.max(-6, v[band])) : 0;
    }
    el("sound-profile").value = selectedProfile;
    el("sound-enabled").checked = opts.enabled;
    for (const band of bands) {
      el("sound-" + band).value = opts[band];
      el("sound-" + band + "-value").textContent = opts[band] + " dB";
    }
  }

  async function apply() {
    if (window.velunaEQ?.applyThreeBand) {
      await window.velunaEQ.applyThreeBand(opts.enabled, opts.bass, opts.mid, opts.high);
      return;
    }
    if (native) {
      native.setEqualizer(opts.enabled, ...bands.map(b => opts[b]));
    }
  }

  function save() {
    opts.enabled = el("sound-enabled").checked;
    for (const band of bands) {
      opts[band] = Number(el("sound-" + band).value);
      el("sound-" + band + "-value").textContent = opts[band] + " dB";
    }
    localStorage.setItem("sound/" + selectedProfile, JSON.stringify(opts));
    apply().catch(e => status(e.message));
  }

  read();
  el("sound-profile").onchange = e => {
    selectedProfile = e.target.value;
    localStorage.setItem("sound-profile", selectedProfile);
    read();
    apply().catch(e => status(e.message));
  };
  el("sound-enabled").onchange = save;
  for (const band of bands) el("sound-" + band).onchange = save;

  const output = el("sound-output");
  if (desktop && navigator.mediaDevices?.selectAudioOutput && audio.setSinkId) {
    output.hidden = false;
    output.onclick = async () => {
      try {
        const d = await navigator.mediaDevices.selectAudioOutput();
        if (window.velunaEQ?.setSink) {
          await window.velunaEQ.setSink(d.deviceId);
        } else {
          await audio.setSinkId(d.deviceId);
        }
        status(d.label || "Đã chọn thiết bị phát.");
      } catch (e) {
        status(e.message);
      }
    };
  }
})();
