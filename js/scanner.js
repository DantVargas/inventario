// Lector de códigos de barras con la cámara.
// Usa el lector nativo del navegador (BarcodeDetector) si existe; si no, ZXing,
// que se carga desde vendor/ solo la primera vez que se abre la cámara.
// Funciona sin internet y también funcionará igual en la versión de escritorio.
(function (global) {
  'use strict';

  // Ruta relativa a este archivo (js/scanner.js), no a la página que lo usa.
  const ZXING_SRC = new URL('../vendor/zxing/zxing.min.js', document.currentScript.src).href;
  const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code'];
  const ZXING_FORMATS = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR', 'QR_CODE'];

  // Zona de la imagen donde se busca el código (debe coincidir con el recuadro en pantalla).
  const SCAN_AREA = { width: 0.8, height: 0.5 };
  const FRAME_INTERVAL_MS = 80;
  // Se acepta un código cuando se lee igual dos veces seguidas: evita lecturas erróneas.
  const CONFIRM_WINDOW_MS = 1500;

  let decoderPromise = null;

  function isSupported() {
    return !!(global.navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('No se pudo cargar el lector de códigos (' + src + ').'));
      document.head.appendChild(s);
    });
  }

  async function createNativeDecoder() {
    if (!('BarcodeDetector' in global)) return null;
    try {
      const supported = await global.BarcodeDetector.getSupportedFormats();
      const formats = NATIVE_FORMATS.filter(f => supported.includes(f));
      if (!formats.includes('ean_13')) return null;
      const detector = new global.BarcodeDetector({ formats });
      return {
        kind: 'nativo',
        decode: async (canvas) => {
          const found = await detector.detect(canvas);
          return found.length ? found[0].rawValue : null;
        },
      };
    } catch {
      return null;
    }
  }

  async function createZxingDecoder() {
    if (!global.ZXing) await loadScript(ZXING_SRC);
    const Z = global.ZXing;
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS.map(f => Z.BarcodeFormat[f]));
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    const reader = new Z.MultiFormatReader();
    reader.setHints(hints);
    return {
      kind: 'zxing',
      decode: async (canvas) => {
        try {
          const source = new Z.HTMLCanvasElementLuminanceSource(canvas);
          return reader.decodeWithState(new Z.BinaryBitmap(new Z.HybridBinarizer(source))).getText();
        } catch {
          return null; // en este cuadro no hay un código legible
        } finally {
          reader.reset();
        }
      },
    };
  }

  function getDecoder() {
    if (!decoderPromise) {
      decoderPromise = (async () => (await createNativeDecoder()) || createZxingDecoder())();
      decoderPromise.catch(() => { decoderPromise = null; }); // permitir reintentar
    }
    return decoderPromise;
  }

  // Lee un código de un canvas (sirve también para probar sin cámara).
  async function decodeCanvas(canvas) {
    const decoder = await getDecoder();
    return decoder.decode(canvas);
  }

  async function listCameras() {
    if (!isSupported() || !navigator.mediaDevices.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(d => d.kind === 'videoinput')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Cámara ${i + 1}` }));
  }

  function friendlyError(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'No hay permiso para usar la cámara. Permítelo en el aviso del navegador (o en el icono de la cámara en la barra de direcciones) y vuelve a intentar.';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No se encontró ninguna cámara conectada.';
    if (name === 'NotReadableError' || name === 'AbortError') return 'La cámara está siendo usada por otro programa. Ciérralo y vuelve a intentar.';
    return (err && err.message) || String(err);
  }

  // Abre la cámara en <video> y busca códigos hasta encontrar uno.
  // Devuelve { stop(), decoderKind, deviceId }. onResult(código) se llama una sola vez.
  async function start({ video, deviceId = null, onResult }) {
    if (!isSupported()) throw new Error('Este navegador no permite usar la cámara.');
    const decoder = await getDecoder();
    const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
    const constraints = {
      audio: false,
      video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: { ideal: 'environment' }, ...size },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    let stopped = false;
    let timer = null;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    };

    try {
      video.muted = true;
      video.setAttribute('playsinline', '');
      video.srcObject = stream;
      await video.play();
    } catch (err) {
      stop();
      throw err;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let last = null;
    let lastAt = 0;

    const tick = async () => {
      if (stopped) return;
      const vw = video.videoWidth, vh = video.videoHeight;
      if (vw && vh) {
        // Recorta la zona central y la achica: menos píxeles = lectura más rápida.
        const cw = Math.round(vw * SCAN_AREA.width), ch = Math.round(vh * SCAN_AREA.height);
        const scale = Math.min(1, 800 / cw);
        canvas.width = Math.round(cw * scale);
        canvas.height = Math.round(ch * scale);
        ctx.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
        let code = null;
        try { code = await decoder.decode(canvas); } catch { code = null; }
        if (stopped) return;
        if (code) {
          const now = performance.now();
          if (code === last && now - lastAt < CONFIRM_WINDOW_MS) {
            stop();
            onResult(code);
            return;
          }
          last = code;
          lastAt = now;
        }
      }
      timer = setTimeout(tick, FRAME_INTERVAL_MS);
    };
    tick();

    const track = stream.getVideoTracks()[0];
    const settings = track && track.getSettings ? track.getSettings() : {};
    return { stop, decoderKind: decoder.kind, deviceId: settings.deviceId || deviceId };
  }

  global.Scanner = { isSupported, start, listCameras, decodeCanvas, friendlyError, SCAN_AREA };
})(window);
