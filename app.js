(() => {
  "use strict";

  const canvas = document.getElementById("screen");
  const context = canvas.getContext("2d", { alpha: false });
  const status = document.getElementById("status");
  context.imageSmoothingEnabled = false;

  const joypad = Object.freeze({
    ArrowUp: 4,
    ArrowDown: 5,
    ArrowLeft: 6,
    ArrowRight: 7,
    KeyZ: 0,
    KeyX: 8,
    ShiftLeft: 9,
    ShiftRight: 9,
    Space: 1,
    Enter: 3,
    NumpadEnter: 3,
    KeyI: 2,
    KeyQ: 10,
    KeyW: 11
  });

  const retroKeys = Object.freeze({
    Backspace: 8,
    Tab: 9,
    Enter: 13,
    NumpadEnter: 271,
    Escape: 27,
    Space: 32,
    ArrowUp: 273,
    ArrowDown: 274,
    ArrowRight: 275,
    ArrowLeft: 276,
    Insert: 277,
    Home: 278,
    End: 279,
    PageUp: 280,
    PageDown: 281,
    F1: 282,
    F2: 283,
    F3: 284,
    F4: 285,
    F5: 286,
    F6: 287,
    F7: 288,
    F8: 289,
    F9: 290,
    F10: 291,
    ShiftRight: 303,
    ShiftLeft: 304,
    ControlRight: 305,
    ControlLeft: 306,
    AltRight: 307,
    AltLeft: 308
  });

  let module;
  let frameImage;
  let framebuffer = 0;

  const fetchDisk = async (file) => {
    const response = await fetch(`./data/${file}?v=playable3`);
    if (!response.ok) throw new Error(`${file}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };

  const wasmBuffer = (bytes) => {
    const pointer = module._malloc(bytes.byteLength);
    module.HEAPU8.set(bytes, pointer);
    return pointer;
  };

  const keyId = (event) => {
    if (retroKeys[event.code] !== undefined) return retroKeys[event.code];
    if (/^Key[A-Z]$/.test(event.code)) return event.code.charCodeAt(3) + 32;
    if (/^Digit[0-9]$/.test(event.code)) return event.code.charCodeAt(5);
    return undefined;
  };

  const setKeyboard = (event, pressed) => {
    if (!module) return;
    const button = joypad[event.code];
    if (button !== undefined) module._mt_set_button(0, button, pressed ? 1 : 0);
    const key = keyId(event);
    if (key !== undefined) module._mt_set_key(key, pressed ? 1 : 0);
    if (button !== undefined || key !== undefined) event.preventDefault();
  };

  window.addEventListener("keydown", event => setKeyboard(event, true), { passive: false });
  window.addEventListener("keyup", event => setKeyboard(event, false), { passive: false });
  window.addEventListener("blur", () => {
    if (!module) return;
    for (let button = 0; button < 16; ++button) module._mt_set_button(0, button, 0);
    for (let key = 0; key < 512; ++key) module._mt_set_key(key, 0);
  });

  document.querySelectorAll("[data-button]").forEach(button => {
    const id = Number(button.dataset.button);
    const set = pressed => {
      if (module) module._mt_set_button(0, id, pressed ? 1 : 0);
      button.classList.toggle("pressed", pressed);
    };
    button.addEventListener("pointerdown", event => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      set(true);
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
      button.addEventListener(name, () => setTimeout(() => set(false), 120));
  });

  canvas.addEventListener("pointerdown", event => {
    event.preventDefault();
    if (!module) return;
    module._mt_set_button(0, 3, 1);
    setTimeout(() => module && module._mt_set_button(0, 3, 0), 240);
  });

  const draw = () => {
    module._mt_emulator_frame();
    frameImage.data.set(module.HEAPU8.subarray(framebuffer, framebuffer + 640 * 400 * 4));
    context.putImageData(frameImage, 0, 0);
    const frames = module._mt_frame_count();
    const lit = module._mt_nonblack_pixels();
    document.body.dataset.frames = String(frames);
    document.body.dataset.nonblack = String(lit);
    if (lit > 0) {
      document.body.dataset.ready = "true";
      status.hidden = true;
    }
    requestAnimationFrame(draw);
  };

  const boot = async () => {
    try {
      const loaded = await Promise.all([
        MegamiTenseiModule({ locateFile: file => `./${file}?v=playable3` }),
        fetchDisk("disk1.bin"),
        fetchDisk("disk2.bin")
      ]);
      module = loaded[0];
      const disk1Pointer = wasmBuffer(loaded[1]);
      const disk2Pointer = wasmBuffer(loaded[2]);
      try {
        if (!module._mt_emulator_init(disk1Pointer, loaded[1].byteLength,
                                      disk2Pointer, loaded[2].byteLength))
          throw new Error("INIT");
      } finally {
        module._free(disk1Pointer);
        module._free(disk2Pointer);
      }
      module._mt_emulator_fast_forward(780);
      framebuffer = module._mt_framebuffer();
      frameImage = context.createImageData(640, 400);
      requestAnimationFrame(draw);
    } catch (error) {
      document.body.dataset.ready = "false";
      status.textContent = "ERROR";
      status.classList.add("error");
      console.error(error);
    }
  };

  boot();
})();
