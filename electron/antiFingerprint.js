// Anti-fingerprinting content script.
// Injected into every page context via CDP Page.addScriptToEvaluateOnNewDocument.
// Runs before any page scripts — overrides browser APIs to prevent passive fingerprinting.

(function () {
  'use strict';

  // ── Window.name isolation ──────────────────────────────────────────────────────
  // window.name persists across navigations and is a well-known cross-site tracking
  // vector (sites encode user IDs here and read them back after redirect).
  try {
    Object.defineProperty(window, 'name', {
      get() { return ''; },
      set() { /* silently discard writes */ },
      configurable: false,
      enumerable: true,
    });
  } catch (_) {}

  // ── Navigator hardware normalization ───────────────────────────────────────────
  // CPU core count and installed RAM are hardware fingerprints.
  // Round both to the most-common values to blend into the crowd.
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 4,
      configurable: false,
      enumerable: true,
    });
  } catch (_) {}

  try {
    if ('deviceMemory' in navigator) {
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
        configurable: false,
        enumerable: true,
      });
    }
  } catch (_) {}

  // ── Battery API removal ────────────────────────────────────────────────────────
  // Battery charge level and discharge rate form a timing-based fingerprint.
  try {
    if ('getBattery' in navigator) {
      Object.defineProperty(navigator, 'getBattery', {
        value: undefined,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    }
  } catch (_) {}

  // ── Network connection normalization ───────────────────────────────────────────
  // RTT, downlink, and effectiveType expose network characteristics.
  try {
    const conn = navigator.connection
      || navigator.mozConnection
      || navigator.webkitConnection;
    if (conn) {
      const overrides = { rtt: 100, downlink: 10, effectiveType: '4g', saveData: false };
      for (const [key, val] of Object.entries(overrides)) {
        try {
          Object.defineProperty(conn, key, {
            get: () => val,
            configurable: false,
          });
        } catch (_) {}
      }
    }
  } catch (_) {}

  // ── WebGL fingerprint spoofing ─────────────────────────────────────────────────
  // The UNMASKED_RENDERER and UNMASKED_VENDOR strings expose GPU model + driver.
  // Return a common Intel string instead.
  const _RENDERER = 'Intel Iris OpenGL Engine';
  const _VENDOR = 'Intel Inc.';

  const _glPatched = new WeakSet();

  const patchGL = (proto) => {
    if (!proto || _glPatched.has(proto)) return;
    _glPatched.add(proto);
    const _orig = proto.getParameter;
    proto.getParameter = function (param) {
      if (param === 37446) return _VENDOR;   // UNMASKED_VENDOR_WEBGL
      if (param === 37445) return _RENDERER; // UNMASKED_RENDERER_WEBGL
      return _orig.call(this, param);
    };
  };

  try {
    const _tmpCanvas = document.createElement('canvas');
    const _gl1 = _tmpCanvas.getContext('webgl')
      || _tmpCanvas.getContext('experimental-webgl');
    if (_gl1) patchGL(Object.getPrototypeOf(_gl1));
    const _gl2 = _tmpCanvas.getContext('webgl2');
    if (_gl2) patchGL(Object.getPrototypeOf(_gl2));
  } catch (_) {}

  // ── Canvas fingerprint noise ───────────────────────────────────────────────────
  // 2D canvas pixel output varies by GPU rasterizer — a classic fingerprint.
  // Add a single ±1 LSB flip to the top-left pixel on every readback.
  // The noise is stable within a page lifetime (same seed) but unique per load.
  try {
    const _CANVAS_NOISE = (Math.random() > 0.5) ? 1 : -1;

    const _origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
      const ctx = this.getContext('2d');
      if (ctx && this.width > 1 && this.height > 1) {
        const px = ctx.getImageData(0, 0, 1, 1);
        px.data[0] = Math.max(0, Math.min(255, px.data[0] + _CANVAS_NOISE));
        ctx.putImageData(px, 0, 0);
      }
      return _origToDataURL.call(this, type, quality);
    };

    const _origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      const ctx = this.getContext('2d');
      if (ctx && this.width > 1 && this.height > 1) {
        const px = ctx.getImageData(0, 0, 1, 1);
        px.data[0] = Math.max(0, Math.min(255, px.data[0] + _CANVAS_NOISE));
        ctx.putImageData(px, 0, 0);
      }
      return _origToBlob.call(this, callback, type, quality);
    };
  } catch (_) {}

  // ── AudioContext fingerprint noise ─────────────────────────────────────────────
  // Audio oscillator output differs per hardware — tiny imperceptible noise breaks
  // this without affecting playback quality.
  try {
    const _AUDIO_NOISE = (Math.random() - 0.5) * 1e-7;

    const _origGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function (ch) {
      const data = _origGetChannelData.call(this, ch);
      if (data.length > 0) data[0] += _AUDIO_NOISE;
      return data;
    };

    if (AudioBuffer.prototype.copyFromChannel) {
      const _origCopy = AudioBuffer.prototype.copyFromChannel;
      AudioBuffer.prototype.copyFromChannel = function (dest, ch, offset) {
        _origCopy.call(this, dest, ch, offset);
        if (dest.length > 0) dest[0] += _AUDIO_NOISE;
      };
    }
  } catch (_) {}

  // ── MediaDevices: strip persistent device IDs ──────────────────────────────────
  // Device IDs from enumerateDevices() are stable per-origin and enable cross-site
  // tracking when shared across origins via postMessage or redirect.
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      const _origEnum = navigator.mediaDevices.enumerateDevices
        .bind(navigator.mediaDevices);
      navigator.mediaDevices.enumerateDevices = () =>
        _origEnum().then(devices =>
          devices.map(({ kind, label }) => ({
            deviceId: '',
            groupId: '',
            kind,
            label,
            toJSON() {
              return { deviceId: '', groupId: '', kind, label };
            },
          }))
        );
    }
  } catch (_) {}

  // ── Keyboard layout fingerprint prevention ─────────────────────────────────────
  // getLayoutMap() returns a per-device keyboard mapping that uniquely identifies
  // the hardware keyboard model.
  try {
    if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
      navigator.keyboard.getLayoutMap = () => Promise.resolve(new Map());
    }
  } catch (_) {}

})();
