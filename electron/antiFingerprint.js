// Anti-fingerprinting content script (TEMPLATE).
//
// Injected into every page/frame at document-start via CDP
// Page.addScriptToEvaluateOnNewDocument, before any page JS runs.
//
// `__FP_SESSION`+`_KEY__` and `__FP`+`_PROFILES__` are substituted by
// electron/fingerprint.js at injection time (see clientSource()). Everything below
// derives from a single seed:
//
//   seed = cyrb53(SESSION_KEY + '|' + registrableDomain(location.hostname))
//
// so the identity is STABLE for this site in this session (repeated canvas/audio
// reads return identical bytes → tamper-detection sees nothing), yet DIFFERENT on
// every other site and reset on every app restart. cyrb53 / registrableDomain /
// PROFILES are kept byte-identical to the copies in electron/fingerprint.js so the
// page's platform, GPU and userAgentData always agree with the User-Agent header
// that the main process sets for this site.

(function () {
  'use strict';

  var SESSION_KEY = '__FP_SESSION_KEY__';
  var PROFILES = __FP_PROFILES__;

  // ── Shared primitives — MUST match electron/fingerprint.js exactly ──
  function cyrb53(str, seed) {
    seed = seed || 0;
    var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  var MULTI_SUFFIX = {
    'co.uk': 1, 'org.uk': 1, 'gov.uk': 1, 'ac.uk': 1, 'co.jp': 1, 'com.au': 1,
    'net.au': 1, 'org.au': 1, 'co.nz': 1, 'com.br': 1, 'co.in': 1, 'com.cn': 1,
    'com.mx': 1, 'com.sg': 1,
  };

  function registrableDomain(hostname) {
    if (!hostname) return '';
    if (/^[\d.]+$/.test(hostname) || hostname === 'localhost' || hostname.indexOf('.') === -1) return hostname;
    var parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    var last2 = parts.slice(-2).join('.');
    if (MULTI_SUFFIX[last2]) return parts.slice(-3).join('.');
    return last2;
  }
  // ────────────────────────────────────────────────────────────────────

  var domain = registrableDomain(location.hostname);
  var fullSeed = cyrb53(SESSION_KEY + '|' + domain);
  var baseSeed = fullSeed >>> 0;
  var profile = PROFILES[fullSeed % PROFILES.length];

  // Deterministic PRNG keyed by an integer index. Same (seed, index) ⇒ same value,
  // regardless of call order, so re-reading a canvas/buffer yields identical noise.
  function rand(index) {
    var t = (baseSeed + Math.imul(index, 0x6D2B79F5)) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  // ── Canvas 2D fingerprint randomization ─────────────────────────────────────────
  // Adds a seeded ±1 LSB jitter to R/G/B of every pixel. Imperceptible (±1/255) but
  // changes any hash of the pixels. Deterministic per site+session.
  var _origGetImageData = (window.CanvasRenderingContext2D || {}).prototype
    ? CanvasRenderingContext2D.prototype.getImageData : null;

  function noiseImageData(img) {
    var d = img.data, len = d.length;
    for (var i = 0; i < len; i += 4) {
      d[i]     = clamp8(d[i]     + ((rand(i)     * 3 | 0) - 1));
      d[i + 1] = clamp8(d[i + 1] + ((rand(i + 1) * 3 | 0) - 1));
      d[i + 2] = clamp8(d[i + 2] + ((rand(i + 2) * 3 | 0) - 1));
    }
    return img;
  }

  // Noisy copy of a canvas via an offscreen 2D canvas — never mutates the visible
  // canvas, and works for WebGL-backed canvases too (drawImage reads the composited
  // output). Uses the UNHOOKED getImageData so noise is applied exactly once.
  function noisyClone(canvas) {
    var w = canvas.width | 0, h = canvas.height | 0;
    if (w < 1 || h < 1) return null;
    try {
      var off = document.createElement('canvas');
      off.width = w; off.height = h;
      var octx = off.getContext('2d');
      octx.drawImage(canvas, 0, 0);
      var img = _origGetImageData.call(octx, 0, 0, w, h);
      noiseImageData(img);
      octx.putImageData(img, 0, 0);
      return off;
    } catch (_) {
      // Tainted (cross-origin) canvas, or 2D unavailable — fall back to the original,
      // which will itself throw the expected SecurityError.
      return null;
    }
  }

  function patchCtx2D(proto) {
    if (!proto || !proto.getImageData) return;
    var orig = proto.getImageData;
    proto.getImageData = function () {
      return noiseImageData(orig.apply(this, arguments));
    };
  }

  try { if (window.CanvasRenderingContext2D) patchCtx2D(CanvasRenderingContext2D.prototype); } catch (_) {}
  try { if (window.OffscreenCanvasRenderingContext2D) patchCtx2D(OffscreenCanvasRenderingContext2D.prototype); } catch (_) {}

  try {
    var _origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function () {
      var off = noisyClone(this);
      return _origToDataURL.apply(off || this, arguments);
    };

    var _origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      var off = noisyClone(this);
      var rest = Array.prototype.slice.call(arguments, 1);
      return _origToBlob.apply(off || this, [cb].concat(rest));
    };
  } catch (_) {}

  // ── WebGL fingerprint spoofing ──────────────────────────────────────────────────
  // getParameter returns the profile's GPU strings (consistent with the UA/platform);
  // readPixels gets tiny seeded byte jitter so GPU-rendered fingerprints vary per site.
  var GL_UNMASKED_VENDOR = 37446;
  var GL_UNMASKED_RENDERER = 37445;

  function patchGL(proto) {
    if (!proto || proto._ssGLPatched) return;
    try { Object.defineProperty(proto, '_ssGLPatched', { value: true }); } catch (_) { return; }

    var origGetParameter = proto.getParameter;
    proto.getParameter = function (p) {
      if (p === GL_UNMASKED_VENDOR) return profile.gpuVendor;
      if (p === GL_UNMASKED_RENDERER) return profile.gpuRenderer;
      return origGetParameter.call(this, p);
    };

    if (proto.readPixels) {
      var origReadPixels = proto.readPixels;
      proto.readPixels = function (x, y, w, h, fmt, type, pixels) {
        origReadPixels.apply(this, arguments);
        if (pixels && pixels.length &&
            (pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)) {
          for (var i = 0; i < pixels.length; i += 4) {
            pixels[i] = clamp8(pixels[i] + ((rand(i) * 3 | 0) - 1));
          }
        }
      };
    }
  }

  try { if (window.WebGLRenderingContext) patchGL(WebGLRenderingContext.prototype); } catch (_) {}
  try { if (window.WebGL2RenderingContext) patchGL(WebGL2RenderingContext.prototype); } catch (_) {}

  // ── AudioContext fingerprint randomization ──────────────────────────────────────
  // ~1e-7 per-sample jitter — far below audible/visible thresholds but enough to
  // change any audio fingerprint hash. Applied once per (buffer, channel) so re-reads
  // are identical and noise never accumulates.
  try {
    if (window.AudioBuffer) {
      var _noisedChannels = new WeakMap();
      var _origGetChannelData = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function (ch) {
        var data = _origGetChannelData.call(this, ch);
        var set = _noisedChannels.get(this);
        if (!set) { set = {}; _noisedChannels.set(this, set); }
        if (!set[ch]) {
          for (var i = 0; i < data.length; i++) data[i] += (rand(i) - 0.5) * 1e-7;
          set[ch] = true;
        }
        return data;
      };

      if (AudioBuffer.prototype.copyFromChannel) {
        var _origCopy = AudioBuffer.prototype.copyFromChannel;
        AudioBuffer.prototype.copyFromChannel = function (dest, ch, offset) {
          _origCopy.call(this, dest, ch, offset);
          if (dest && dest.length) {
            for (var i = 0; i < dest.length; i++) dest[i] += (rand(i) - 0.5) * 1e-7;
          }
        };
      }
    }
  } catch (_) {}

  // AnalyserNode readouts (frequency / time domain) used by some audio fingerprinters.
  try {
    if (window.AnalyserNode) {
      var ap = AnalyserNode.prototype;
      var _off = ap.getFloatFrequencyData;
      if (_off) ap.getFloatFrequencyData = function (arr) {
        _off.call(this, arr);
        for (var i = 0; i < arr.length; i++) arr[i] += (rand(i) - 0.5) * 1e-4;
      };
      var _obf = ap.getByteFrequencyData;
      if (_obf) ap.getByteFrequencyData = function (arr) {
        _obf.call(this, arr);
        for (var i = 0; i < arr.length; i++) arr[i] = clamp8(arr[i] + (rand(i) * 3 | 0) - 1);
      };
      var _oft = ap.getFloatTimeDomainData;
      if (_oft) ap.getFloatTimeDomainData = function (arr) {
        _oft.call(this, arr);
        for (var i = 0; i < arr.length; i++) arr[i] += (rand(i) - 0.5) * 1e-5;
      };
      var _obt = ap.getByteTimeDomainData;
      if (_obt) ap.getByteTimeDomainData = function (arr) {
        _obt.call(this, arr);
        for (var i = 0; i < arr.length; i++) arr[i] = clamp8(arr[i] + (rand(i) * 3 | 0) - 1);
      };
    }
  } catch (_) {}

  // ── Navigator identity consistency ──────────────────────────────────────────────
  // navigator.userAgent itself is set by the main process (webContents.setUserAgent)
  // to profile.ua; here we align platform + userAgentData so JS-side checks match it.
  try {
    Object.defineProperty(navigator, 'platform', {
      get: function () { return profile.platform; },
      configurable: false, enumerable: true,
    });
  } catch (_) {}

  try {
    var brands = [
      { brand: 'Not_A Brand', version: '99' },
      { brand: 'Chromium', version: profile.chromeMajor },
      { brand: 'Google Chrome', version: profile.chromeMajor },
    ];
    var fullVersionList = [
      { brand: 'Not_A Brand', version: '99.0.0.0' },
      { brand: 'Chromium', version: profile.chromeFull },
      { brand: 'Google Chrome', version: profile.chromeFull },
    ];
    var highEntropy = {
      architecture: profile.arch,
      bitness: '64',
      brands: brands,
      fullVersionList: fullVersionList,
      mobile: false,
      model: '',
      platform: profile.uaPlatform,
      platformVersion: profile.platformVersion,
      uaFullVersion: profile.chromeFull,
      wow64: false,
    };
    var uaData = {
      brands: brands,
      mobile: false,
      platform: profile.uaPlatform,
      getHighEntropyValues: function (hints) {
        var out = { brands: brands, mobile: false, platform: profile.uaPlatform };
        if (hints && hints.forEach) hints.forEach(function (h) {
          if (h in highEntropy) out[h] = highEntropy[h];
        });
        return Promise.resolve(out);
      },
      toJSON: function () { return { brands: brands, mobile: false, platform: profile.uaPlatform }; },
    };
    Object.defineProperty(navigator, 'userAgentData', {
      get: function () { return uaData; },
      configurable: false, enumerable: true,
    });
  } catch (_) {}

  // ── Window.name isolation ──────────────────────────────────────────────────────
  // window.name persists across navigations and is a well-known cross-site tracking
  // vector (sites encode user IDs here and read them back after redirect).
  try {
    Object.defineProperty(window, 'name', {
      get: function () { return ''; },
      set: function () { /* silently discard writes */ },
      configurable: false, enumerable: true,
    });
  } catch (_) {}

  // ── Navigator hardware normalization ───────────────────────────────────────────
  // CPU core count and installed RAM are hardware fingerprints — pin to common values.
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: function () { return 4; }, configurable: false, enumerable: true,
    });
  } catch (_) {}

  try {
    if ('deviceMemory' in navigator) {
      Object.defineProperty(navigator, 'deviceMemory', {
        get: function () { return 8; }, configurable: false, enumerable: true,
      });
    }
  } catch (_) {}

  // ── Battery API removal ────────────────────────────────────────────────────────
  try {
    if ('getBattery' in navigator) {
      Object.defineProperty(navigator, 'getBattery', {
        value: undefined, writable: false, configurable: false, enumerable: true,
      });
    }
  } catch (_) {}

  // ── Network connection normalization ───────────────────────────────────────────
  try {
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      var overrides = { rtt: 100, downlink: 10, effectiveType: '4g', saveData: false };
      for (var key in overrides) {
        (function (k, v) {
          try { Object.defineProperty(conn, k, { get: function () { return v; }, configurable: false }); } catch (_) {}
        })(key, overrides[key]);
      }
    }
  } catch (_) {}

  // ── MediaDevices: strip persistent device IDs ──────────────────────────────────
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      var _origEnum = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      navigator.mediaDevices.enumerateDevices = function () {
        return _origEnum().then(function (devices) {
          return devices.map(function (d) {
            var kind = d.kind, label = d.label;
            return {
              deviceId: '', groupId: '', kind: kind, label: label,
              toJSON: function () { return { deviceId: '', groupId: '', kind: kind, label: label }; },
            };
          });
        });
      };
    }
  } catch (_) {}

  // ── Keyboard layout fingerprint prevention ─────────────────────────────────────
  try {
    if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
      navigator.keyboard.getLayoutMap = function () { return Promise.resolve(new Map()); };
    }
  } catch (_) {}

})();
