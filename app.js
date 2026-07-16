(() => {
  "use strict";

  const status = document.getElementById("status");
  const progress = document.getElementById("progress");
  const grid = document.getElementById("disk-grid");

  const setProgress = (text, percent) => {
    status.textContent = text;
    progress.style.width = `${percent}%`;
  };

  const hex = (buffer) => [...new Uint8Array(buffer)]
    .map(value => value.toString(16).padStart(2, "0")).join("");

  const digest = async (buffer) => hex(await crypto.subtle.digest("SHA-256", buffer));

  const inspect = (module, buffer) => {
    const bytes = new Uint8Array(buffer);
    const pointer = module._malloc(bytes.byteLength);
    try {
      module.writeArrayToMemory(bytes, pointer);
      const jsonPointer = module._mt_inspect_disk(pointer, bytes.byteLength);
      return JSON.parse(module.UTF8ToString(jsonPointer));
    } finally {
      module._free(pointer);
    }
  };

  const renderDisk = (entry, report, verified) => {
    const sizes = Object.entries(report.sectorSizes)
      .map(([size, count]) => `${count} × ${size}B`).join(" · ");
    const records = Object.keys(report.recordIds).join(", ");
    const card = document.createElement("article");
    card.className = "disk-card";
    card.innerHTML = `
      <div class="disk-number">${entry.id.toUpperCase()}</div>
      <span class="badge ${verified ? "ok" : "bad"}">${verified ? "SHA-256 OK" : "HASH ERROR"}</span>
      <dl>
        <div><dt>TRACKS</dt><dd>${report.tracks}</dd></div>
        <div><dt>SECTORS</dt><dd>${report.sectors}</dd></div>
        <div><dt>PAYLOAD</dt><dd>${report.payloadBytes.toLocaleString()} B</dd></div>
      </dl>
      <p><b>Sector sizes</b>${sizes}</p>
      <p><b>Record IDs</b>${records}</p>`;
    grid.appendChild(card);
  };

  const boot = async () => {
    try {
      setProgress("正在加载 WASM 引擎…", 12);
      const [module, manifestResponse] = await Promise.all([
        createMegatenModule({ locateFile: file => `./${file}` }),
        fetch("./data/manifest.json", { cache: "no-cache" })
      ]);
      if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
      const manifest = await manifestResponse.json();

      let completed = 0;
      for (const entry of manifest.disks) {
        setProgress(`正在装载 ${entry.id.toUpperCase()}…`, 30 + completed * 30);
        const response = await fetch(`./data/${entry.file}`);
        if (!response.ok) throw new Error(`${entry.file} HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const [hash, report] = await Promise.all([
          digest(buffer),
          Promise.resolve(inspect(module, buffer))
        ]);
        if (!report.ok) throw new Error(report.error);
        renderDisk(entry, report, hash === entry.sha256);
        completed += 1;
      }
      setProgress("WASM 引擎及双盘数据装载完成", 100);
      document.body.classList.add("ready");
    } catch (error) {
      setProgress(`启动失败：${error.message}`, 100);
      document.body.classList.add("failed");
      console.error(error);
    }
  };

  boot();
})();
