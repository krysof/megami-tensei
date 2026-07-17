(() => {
  "use strict";
  const canvas = document.getElementById("screen");
  const controls = document.getElementById("controls");
  const context = canvas.getContext("2d", {alpha: false});
  const status = document.getElementById("status");
  const runtimeVersion = "attack-direction-1";
  const assetVersion = "native-bin-layout-1";
  let module = null;
  let audioContext = null;
  let audioNode = null;
  let audioPointer = 0;
  let saveRevision = 0;
  const saveKey = "megami-tensei.native-save.v1";
  context.imageSmoothingEnabled = false;
  const joypad = Object.freeze({
    ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7,
    KeyZ: 0, KeyX: 8, Space: 1, Enter: 3, NumpadEnter: 3, KeyI: 2
  });

  const blockBrowserGesture = event => event.preventDefault();
  for (const name of ["contextmenu", "selectstart", "dragstart", "dblclick"])
    controls.addEventListener(name, blockBrowserGesture);
  for (const name of ["touchstart", "touchmove", "touchend", "touchcancel"])
    controls.addEventListener(name, blockBrowserGesture, {passive: false});
  for (const name of ["gesturestart", "gesturechange", "gestureend"])
    document.addEventListener(name, blockBrowserGesture, {passive: false});

  const setKeyboard = (event, pressed) => {
    const button = joypad[event.code];
    if (button === undefined) return;
    if (module) module._mt_native_set_button(button, pressed ? 1 : 0);
    event.preventDefault();
  };
  window.addEventListener("keydown", event => setKeyboard(event, true), {passive: false});
  window.addEventListener("keyup", event => setKeyboard(event, false), {passive: false});
  const joystick = document.querySelector("[data-joystick]");
  const joystickKnob = joystick.querySelector(".joystick-knob");
  let joystickPointer = null;
  let joystickButton = null;
  const setJoystickButton = next => {
    if (next === joystickButton) return;
    if (module && joystickButton !== null) module._mt_native_set_button(joystickButton, 0);
    joystickButton = next;
    if (module && joystickButton !== null) module._mt_native_set_button(joystickButton, 1);
  };
  const updateJoystick = event => {
    const rect = joystick.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy);
    const travel = rect.width * .29;
    const scale = distance > travel ? travel / distance : 1;
    joystickKnob.style.setProperty("--joy-x", `${dx * scale}px`);
    joystickKnob.style.setProperty("--joy-y", `${dy * scale}px`);
    if (distance < rect.width * .12) {
      setJoystickButton(null);
      return;
    }
    const rotated = matchMedia("(orientation: portrait) and (pointer: coarse)").matches;
    const virtualX = rotated ? dy : dx;
    const virtualY = rotated ? -dx : dy;
    if (Math.abs(virtualX) >= Math.abs(virtualY))
      setJoystickButton(virtualX < 0 ? 6 : 7);
    else
      setJoystickButton(virtualY < 0 ? 4 : 5);
  };
  const releaseJoystick = () => {
    setJoystickButton(null);
    joystickPointer = null;
    joystickKnob.style.setProperty("--joy-x", "0px");
    joystickKnob.style.setProperty("--joy-y", "0px");
  };
  joystick.addEventListener("pointerdown", event => {
    event.preventDefault();
    joystickPointer = event.pointerId;
    joystick.setPointerCapture(event.pointerId);
    updateJoystick(event);
  });
  joystick.addEventListener("pointermove", event => {
    if (event.pointerId === joystickPointer) updateJoystick(event);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    joystick.addEventListener(name, event => {
      if (event.pointerId === joystickPointer) releaseJoystick();
    });
  window.addEventListener("blur", () => {
    if (module)
      for (let button = 0; button < 16; ++button) module._mt_native_set_button(button, 0);
    releaseJoystick();
  });

  document.querySelectorAll("[data-button]").forEach(button => {
    let activeId = null;
    const currentId = () => Number(button.dataset.button);
    const set = pressed => {
      if (pressed) {
        activeId = currentId();
        if (module) module._mt_native_set_button(activeId, 1);
      } else if (activeId !== null) {
        if (module) module._mt_native_set_button(activeId, 0);
        activeId = null;
      }
      button.classList.toggle("pressed", pressed);
    };
    button.addEventListener("pointerdown", event => {
      event.preventDefault(); button.setPointerCapture(event.pointerId); set(true);
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
      button.addEventListener(name, () => set(false));
  });

  canvas.addEventListener("pointerdown", event => {
    event.preventDefault();
    if (!module) return;
    module._mt_native_set_button(0, 1);
    setTimeout(() => module && module._mt_native_set_button(0, 0), 160);
  });

  const startAudio = async () => {
    if (!module) {
      document.body.dataset.audio = "waiting";
      return;
    }
    if (audioContext) {
      if (audioContext.state !== "running") await audioContext.resume();
      document.body.dataset.audio = audioContext.state;
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    audioContext = new AudioContext({latencyHint: "interactive"});
    const frames = 1024;
    audioPointer = module._malloc(frames * 4);
    audioNode = audioContext.createScriptProcessor(frames, 0, 2);
    audioNode.onaudioprocess = event => {
      if (!module._mt_native_render_audio(audioPointer, frames, audioContext.sampleRate)) return;
      const pcm = new Int16Array(module.HEAPU8.buffer, audioPointer, frames * 2);
      const left = event.outputBuffer.getChannelData(0);
      const right = event.outputBuffer.getChannelData(1);
      for (let frame = 0; frame < frames; ++frame) {
        left[frame] = pcm[frame * 2] / 32768;
        right[frame] = pcm[frame * 2 + 1] / 32768;
      }
    };
    audioNode.connect(audioContext.destination);
    await audioContext.resume();
    document.body.dataset.audio = audioContext.state;
  };

  const encodeSave = bytes => {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
  };

  const decodeSave = text => {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; ++index) bytes[index] = binary.charCodeAt(index);
    return bytes;
  };

  const restoreSave = () => {
    const encoded = localStorage.getItem(saveKey);
    if (!encoded) return false;
    const bytes = decodeSave(encoded);
    const pointer = module._malloc(bytes.length);
    try {
      module.HEAPU8.set(bytes, pointer);
      return module._mt_native_restore_save(pointer, bytes.length) !== 0;
    } finally {
      module._free(pointer);
    }
  };

  const persistSave = () => {
    const revision = module._mt_native_save_revision();
    if (revision === saveRevision) return;
    const size = module._mt_native_save_size();
    const pointer = module._mt_native_save_data();
    if (size && pointer) {
      const bytes = module.HEAPU8.slice(pointer, pointer + size);
      localStorage.setItem(saveKey, encodeSave(bytes));
    }
    saveRevision = revision;
    document.body.dataset.saveRevision = String(revision);
  };

  const requestAudio = () => { startAudio().catch(() => {
    document.body.dataset.audio = "error";
  }); };
  window.addEventListener("pointerdown", requestAudio, {passive: true});
  window.addEventListener("touchstart", requestAudio, {passive: true});
  window.addEventListener("keydown", requestAudio);
  window.addEventListener("pagehide", () => {
    if (audioNode) audioNode.disconnect();
    if (module && audioPointer) module._free(audioPointer);
    audioPointer = 0;
  });

  const boot = async () => {
    try {
      const [runtime, response] = await Promise.all([
        MegamiTenseiNative({locateFile: file => `${file}?v=${runtimeVersion}`}),
        fetch(`megaten-assets.bin?v=${assetVersion}`)
      ]);
      module = runtime;
      if (!response.ok) throw new Error(`ASSETS ${response.status}`);
      const assets = new Uint8Array(await response.arrayBuffer());
      const pointer = module._malloc(assets.length);
      module.HEAPU8.set(assets, pointer);
      const initialized = module._mt_native_init(pointer, assets.length);
      module._free(pointer);
      if (!initialized) throw new Error(module.UTF8ToString(module._mt_native_last_error()));
      try {
        document.body.dataset.saveRestored = restoreSave() ? "true" : "false";
      } catch (_) {
        document.body.dataset.saveRestored = "false";
      }

      const width = module._mt_native_width();
      const height = module._mt_native_height();
      const framebuffer = module._mt_native_framebuffer();
      const image = context.createImageData(width, height);
      const draw = () => {
        module._mt_native_frame();
        image.data.set(module.HEAPU8.subarray(framebuffer, framebuffer + width * height * 4));
        context.putImageData(image, 0, 0);
        document.body.dataset.frames = String(module._mt_native_frame_count());
        document.body.dataset.scene = String(module._mt_native_scene());
        document.body.dataset.selection = String(module._mt_native_selection());
        document.body.dataset.stage = String(module._mt_native_stage());
        document.body.dataset.map = String(module._mt_native_map());
        document.body.dataset.playerX = String(module._mt_native_player_x());
        document.body.dataset.playerY = String(module._mt_native_player_y());
        document.body.dataset.currentHp = String(module._mt_native_current_hp());
        document.body.dataset.lastContactType = String(module._mt_native_last_contact_type());
        document.body.dataset.activeActions = String(module._mt_native_active_actions());
        document.body.dataset.lastActionDamage = String(module._mt_native_last_action_damage());
        document.body.dataset.level = String(module._mt_native_level());
        document.body.dataset.experience = String(module._mt_native_experience());
        document.body.dataset.defeatedEntities = String(module._mt_native_defeated_entities());
        document.body.dataset.weapon = String(module._mt_native_weapon());
        document.body.dataset.actionMode = String(module._mt_native_action_mode());
        document.body.dataset.selectorOpen = String(module._mt_native_selector_open());
        document.body.dataset.selectorRow = String(module._mt_native_selector_row());
        document.body.dataset.selectorSelection = String(module._mt_native_selector_selection());
        document.body.dataset.shopOpen = String(module._mt_native_shop_open());
        document.body.dataset.shopSelection = String(module._mt_native_shop_selection());
        document.body.dataset.money = String(module._mt_native_money());
        document.body.dataset.spawn31Active = String(module._mt_native_selector_spawn_active(31));
        document.body.dataset.spawn31Count = String(module._mt_native_selector_spawn_count(31));
        document.body.dataset.spawnProperty = String(module._mt_native_property_at(8, 10));
        document.body.dataset.spawnPropertyNext = String(module._mt_native_property_at(10, 10));
        document.body.dataset.timedMonitorFrames = String(module._mt_native_timed_monitor_frames());
        document.body.dataset.monitorDetailActive = String(module._mt_native_monitor_detail_active());
        try { persistSave(); } catch (_) {}
        requestAnimationFrame(draw);
      };
      status.hidden = true;
      document.body.dataset.ready = "true";
      draw();
    } catch (error) {
      status.textContent = "ERROR";
      document.body.dataset.error = String(error);
    }
  };
  boot();
})();
