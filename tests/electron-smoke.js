// Prueba de humo de la app de escritorio: abre la ventana real (oculta), la usa y revisa el disco.
// Solo se carga desde electron/main.js si INVENTARIO_SMOKE_TEST está definida y la app no está instalada.
//   Fase 1: crear producto, ajustar stock, ajustes, cámara.   Fase 2: reabrir y comprobar que todo sigue.
'use strict';

const fs = require('fs');
const { app } = require('electron');

// Se ejecuta dentro de la ventana.
async function inWindow(phase) {
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(50); } return false; };
  const rows = () => [...document.querySelectorAll('#products-body tr')].map(r => r.innerText.replace(/\s+/g, ' ').trim());
  const r = { phase };
  await until(() => $('#empty-msg').textContent || rows().length);

  r.storeKind = window.Store && window.Store.kind;
  r.platformKind = window.Platform && window.Platform.kind;
  r.nodeVisible = typeof require !== 'undefined' || typeof process !== 'undefined';

  if (phase === '1') {
    r.emptyMsg = $('#empty-msg').textContent;
    // Crear producto con categoría nueva
    $('#btn-new').click();
    const f = $('#product-form');
    f.elements.sku.value = '7790001234568'; f.elements.name.value = 'Aceite 900 ml';
    f.elements.cost.value = '2'; f.elements.price.value = '3,5'; f.elements.stock.value = '5'; f.elements.minStock.value = '2';
    const sel = $('#category-select'); sel.value = '__new__'; sel.dispatchEvent(new Event('change'));
    $('#new-category').value = 'Almacén';
    f.requestSubmit();
    await until(() => rows().length === 1);
    // Ajustar stock +3
    document.querySelector('[data-action=adjust]').click();
    const a = $('#adjust-form'); a.elements.qty.value = '3'; a.requestSubmit();
    await until(() => !$('#adjust-dialog').open);
    await wait(200);
    // Código repetido: lo rechaza
    $('#btn-new').click();
    f.elements.sku.value = '7790001234568'; f.elements.name.value = 'Otro'; f.requestSubmit();
    await wait(200);
    r.duplicateError = $('#form-error').textContent;
    $('#product-dialog [data-close]').click();
    // Ajustes
    $('#btn-settings').click();
    const s = $('#settings-form'); s.elements.storeName.value = 'Kiosco de prueba'; s.requestSubmit();
    await wait(300);
    $('#btn-settings').click();
    await until(() => !$('#desktop-data').hidden);
    r.settingsDataPath = $('#desktop-data-path').textContent;
    $('#settings-dialog [data-close]').click();
    // Cámara: video permitido, micrófono no
    try { const st = await navigator.mediaDevices.getUserMedia({ video: true }); r.camera = 'ok: ' + st.getVideoTracks()[0].label; st.getTracks().forEach(t => t.stop()); }
    catch (e) { r.camera = 'error: ' + e.name; }
    try { await navigator.mediaDevices.getUserMedia({ audio: true }); r.microphone = 'permitido (MAL)'; }
    catch (e) { r.microphone = 'bloqueado: ' + e.name; }
    // Escáner abre la cámara dentro de la app
    $('#btn-scan').click();
    await until(() => $('#scan-status').textContent.startsWith('Apunta'), 6000);
    r.scannerStatus = $('#scan-status').textContent;
    r.scannerVideo = $('#scan-video').videoWidth + 'x' + $('#scan-video').videoHeight;
    $('#scan-cancel').click();
    await wait(100);
    r.cameraOffAfterClose = $('#scan-video').srcObject === null;
  }

  r.rows = rows();
  r.title = document.title;
  return r;
}

exports.run = (win, store) => {
  const phase = process.env.INVENTARIO_SMOKE_TEST;
  const errors = [];
  win.webContents.on('console-message', (e) => {
    const level = e.level !== undefined ? e.level : e;
    if (level === 'error' || level === 3) errors.push(e.message);
  });
  win.webContents.once('did-finish-load', async () => {
    let result;
    try {
      result = await win.webContents.executeJavaScript(`(${inWindow.toString()})(${JSON.stringify(phase)})`, true);
      await store.flush();
      const disk = JSON.parse(fs.readFileSync(store.file, 'utf8'));
      result.disk = { products: disk.products.map(p => `${p.name} | ${p.category} | stock ${p.stock}`), settings: disk.settings };
      result.backups = fs.readdirSync(store.backupDir);
    } catch (err) {
      result = { error: String((err && err.stack) || err) };
    }
    result.consoleErrors = errors;
    process.stdout.write('SMOKE_RESULT ' + JSON.stringify(result, null, 1) + '\n');
    app.quit();
  });
};
