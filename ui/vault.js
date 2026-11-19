window.velunaVault = {
  async read(slot) {
    if (window.VelunaAndroid) return window.VelunaAndroid.readSecret(slot);
    return window.__TAURI__.core.invoke("read_secret", {slot});
  },
  async write(slot, value) {
    if (window.VelunaAndroid) {
      if (!window.VelunaAndroid.writeSecret(slot, value)) throw Error("Không ghi được kho bảo mật trên thiết bị.");
    } else await window.__TAURI__.core.invoke("write_secret", {slot, value});
  }
};
