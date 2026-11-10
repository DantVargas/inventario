// Interfaz: conecta la pantalla con la lógica (Inventory), los datos (Store)
// y los archivos (Platform). No guarda nada por su cuenta.
(() => {
  'use strict';
  const I = window.Inventory;
  const Store = window.Store;
  const Platform = window.Platform;

  const state = {
    products: [],
    settings: { ...I.DEFAULT_SETTINGS },
    sort: { key: 'name', dir: 'asc' },
    adjustingId: null, // id del producto abierto en el diálogo de ajuste
    lastAdjustMode: 'in', // se recuerda para escanear varios productos seguidos
    rescanAfter: false, // modo rápido: reabrir la cámara al terminar
  };

  const $ = (sel) => document.querySelector(sel);
  const el = {
    storeName: $('#store-name'),
    body: $('#products-body'),
    empty: $('#empty-msg'),
    search: $('#search'),
    filterCategory: $('#filter-category'),
    filterStatus: $('#filter-status'),
    categorySelect: $('#category-select'),
    newCategory: $('#new-category'),
    productDialog: $('#product-dialog'),
    productForm: $('#product-form'),
    productTitle: $('#product-dialog-title'),
    pricePreview: $('#price-preview'),
    formError: $('#form-error'),
    adjustDialog: $('#adjust-dialog'),
    adjustForm: $('#adjust-form'),
    adjustProduct: $('#adjust-product'),
    adjustQtyLabel: $('#adjust-qty-label'),
    adjustPreview: $('#adjust-preview'),
    adjustError: $('#adjust-error'),
    settingsDialog: $('#settings-dialog'),
    settingsForm: $('#settings-form'),
    confirmDialog: $('#confirm-dialog'),
    confirmText: $('#confirm-text'),
    confirmOk: $('#confirm-ok'),
    scanDialog: $('#scan-dialog'),
    scanView: $('.scan-view'),
    scanVideo: $('#scan-video'),
    scanStatus: $('#scan-status'),
    scanCamera: $('#scan-camera'),
    scanContinuous: $('#scan-continuous'),
    scanContinuousWrap: $('#scan-continuous-wrap'),
    scanManual: $('#scan-manual'),
    scanManualInput: $('#scan-manual-input'),
    toast: $('#toast'),
  };

  // Preferencias de este equipo (cámara elegida, modo rápido). Si no se pueden guardar, no pasa nada.
  const prefs = {
    get(key, fallback) {
      try { const v = localStorage.getItem('inventario.' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('inventario.' + key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
    },
  };

  // ---------- Formato y avisos ----------
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const numFmt = new Intl.NumberFormat('es', { maximumFractionDigits: 3 });
  const moneyFmt = new Intl.NumberFormat('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = (n) => numFmt.format(n || 0);
  const money = (n) => `${state.settings.currency} ${moneyFmt.format(n || 0)}`;
  const pct = (n) => (n === null ? null : `${numFmt.format(Math.round(n))}%`);
  const errMsg = (err) => (err && err.message) || String(err);
  const today = () => new Date().toISOString().slice(0, 10);

  let toastTimer;
  function toast(msg, isError = false) {
    el.toast.textContent = msg;
    el.toast.classList.toggle('error', isError);
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, isError ? 5000 : 2800);
  }

  // Responde al pulsar un botón (submit); el cierre (tecla Esc) queda como respaldo.
  function confirmAction(text, { okLabel = 'Aceptar', danger = true } = {}) {
    el.confirmOk.textContent = okLabel;
    el.confirmOk.className = `btn ${danger ? 'danger' : 'primary'}`;
    return new Promise(resolve => {
      const dialog = el.confirmDialog;
      const form = dialog.querySelector('form');
      let done = false;
      const finish = (answer) => {
        if (done) return;
        done = true;
        form.removeEventListener('submit', onSubmit);
        dialog.removeEventListener('close', onClose);
        resolve(answer);
      };
      const onSubmit = (e) => finish(!!e.submitter && e.submitter.value === 'yes');
      const onClose = () => finish(dialog.returnValue === 'yes');
      form.addEventListener('submit', onSubmit);
      dialog.addEventListener('close', onClose);
      el.confirmText.textContent = text;
      dialog.returnValue = '';
      dialog.showModal();
    });
  }

  // ---------- Render ----------
  function visibleProducts() {
    const filter = {
      query: el.search.value,
      category: el.filterCategory.value,
      status: el.filterStatus.value,
    };
    const list = state.products.filter(p => I.matchesFilter(p, filter));
    return I.sortProducts(list, state.sort.key, state.sort.dir);
  }

  function renderStats() {
    const t = I.totals(state.products);
    $('#stat-products').textContent = num(t.count);
    $('#stat-cost').textContent = money(t.costValue);
    $('#stat-price').textContent = money(t.priceValue);
    $('#stat-low').textContent = num(t.low);
    $('#stat-out').textContent = num(t.out);
  }

  function renderCategories() {
    const cats = I.listCategories(state.products);
    const current = el.filterCategory.value;
    el.filterCategory.innerHTML = '<option value="">Todas las categorías</option>' +
      cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    el.filterCategory.value = cats.includes(current) ? current : '';
  }

  // ---------- Selector de categoría del formulario ----------
  const NEW_CATEGORY = '__new__';

  function fillCategorySelect(selected) {
    const cats = I.listCategories(state.products);
    el.categorySelect.innerHTML =
      '<option value="">Sin categoría</option>' +
      (cats.length ? `<optgroup label="Categorías existentes">${
        cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</optgroup>` : '') +
      `<option value="${NEW_CATEGORY}">+ Nueva categoría…</option>`;
    el.categorySelect.value = cats.includes(selected) ? selected : '';
    toggleNewCategory(false);
  }

  function toggleNewCategory(focus = true) {
    const isNew = el.categorySelect.value === NEW_CATEGORY;
    el.newCategory.hidden = !isNew;
    if (!isNew) el.newCategory.value = '';
    else if (focus) el.newCategory.focus();
  }

  const dash = '<span class="muted">—</span>';
  const pctCell = (n) => (n === null ? dash : `<span class="${n < 0 ? 'neg' : 'pos'}">${pct(n)}</span>`);

  function rowHtml(p) {
    const status = I.stockStatus(p);
    return `
      <tr data-id="${escapeHtml(p.id)}" class="status-${status}">
        <td>${p.sku ? escapeHtml(p.sku) : dash}</td>
        <td class="name">${escapeHtml(p.name)}</td>
        <td>${p.category ? escapeHtml(p.category) : dash}</td>
        <td class="num">
          <span class="stock-cell">
            <button class="btn small" data-action="dec" title="Restar 1" ${p.stock < 1 ? 'disabled' : ''}>−</button>
            <button class="stock-value" data-action="adjust" title="Ajustar cantidad">
              ${num(p.stock)} <span class="unit">${escapeHtml(p.unit)}</span>
            </button>
            <button class="btn small" data-action="inc" title="Sumar 1">+</button>
          </span>
        </td>
        <td class="num">${p.minStock ? num(p.minStock) : dash}</td>
        <td class="num">${money(p.cost)}</td>
        <td class="num">${money(p.price)}</td>
        <td class="num">${pctCell(I.markup(p))}</td>
        <td class="num">${pctCell(I.margin(p))}</td>
        <td class="num actions">
          <button class="btn link" data-action="edit">Editar</button>
          <button class="btn link del" data-action="delete">Eliminar</button>
        </td>
      </tr>`;
  }

  function renderTable() {
    const list = visibleProducts();
    el.body.innerHTML = list.map(rowHtml).join('');

    if (state.products.length === 0) {
      el.empty.textContent = 'Todavía no hay productos. Pulsa "+ Nuevo producto" para empezar.' +
        (Store && Store.kind === 'desktop'
          ? ' ¿Ya tenías productos en la versión del navegador? Allí usa "Copia de seguridad" y aquí "Restaurar".'
          : '');
    } else if (list.length === 0) {
      el.empty.textContent = 'Ningún producto coincide con la búsqueda o los filtros.';
    }
    el.empty.hidden = list.length > 0;

    document.querySelectorAll('th[data-sort]').forEach(th => {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.dataset.sort === state.sort.key) th.classList.add(`sorted-${state.sort.dir}`);
    });
  }

  function renderAll() {
    el.storeName.textContent = state.settings.storeName;
    document.title = `Inventario · ${state.settings.storeName}`;
    renderStats();
    renderCategories();
    renderTable();
  }

  // Guarda un producto y actualiza la lista en memoria solo si se guardó bien.
  async function persist(p) {
    await Store.saveProduct(p);
    const i = state.products.findIndex(o => o.id === p.id);
    if (i >= 0) state.products[i] = p; else state.products.push(p);
  }

  // ---------- Formulario de producto ----------
  function updatePricePreview() {
    const f = el.productForm.elements;
    const cost = I.parseNumber(f.cost.value);
    const price = I.parseNumber(f.price.value);
    if (!(cost > 0) || !(price > 0)) { el.pricePreview.textContent = ''; return; }
    const p = { cost, price };
    el.pricePreview.textContent = `Ganancia ${money(price - cost)} por ${f.unit.value.trim() || 'unidad'} · ` +
      `Recargo ${pct(I.markup(p))} · Margen ${pct(I.margin(p))}`;
    el.pricePreview.classList.toggle('neg', price < cost);
  }

  // sku: código ya escaneado para un producto nuevo. rescan: modo rápido del escáner.
  function openProductForm(product, { sku = '', rescan = false } = {}) {
    const f = el.productForm;
    f.reset();
    state.rescanAfter = rescan;
    el.formError.hidden = true;
    el.productTitle.textContent = product ? 'Editar producto' : 'Nuevo producto';
    // Producto nuevo: si hay una categoría filtrada, viene elegida de antemano.
    const p = product || { unit: 'unidad', category: el.filterCategory.value, sku };
    for (const name of ['id', 'sku', 'name', 'unit', 'cost', 'price', 'stock', 'minStock', 'notes']) {
      const v = p[name];
      f.elements[name].value = typeof v === 'number' ? String(v).replace('.', ',') : (v ?? '');
    }
    fillCategorySelect(p.category);
    updatePricePreview();
    el.productDialog.showModal();
    f.elements[product || sku ? 'name' : 'sku'].focus();
  }

  // Botón de cámara junto al campo Código del formulario.
  function scanIntoSkuField() {
    openScanner('sku', (code) => {
      const f = el.productForm.elements;
      f.sku.value = code;
      el.formError.hidden = true;
      const dup = I.findBySku(state.products, code);
      if (dup && dup.id !== f.id.value) showFormError(`El código "${code}" ya lo usa "${dup.name}".`, 'sku');
      else f[f.name.value.trim() ? 'cost' : 'name'].focus();
    });
  }

  function showFormError(msg, field) {
    el.formError.textContent = msg;
    el.formError.hidden = false;
    if (field) el.productForm.elements[field].focus();
  }

  async function saveProduct(e) {
    e.preventDefault();
    const raw = Object.fromEntries(new FormData(el.productForm));
    if (raw.categoryChoice === NEW_CATEGORY) {
      if (!raw.newCategory.trim()) return showFormError('Escribe el nombre de la nueva categoría o elige una existente.', 'newCategory');
      // Si ya existe escrita de otra forma, se usa la existente para no duplicarla.
      raw.category = I.resolveCategory(raw.newCategory, I.listCategories(state.products));
    } else {
      raw.category = raw.categoryChoice;
    }
    const problem = I.validateProduct(raw, state.products);
    if (problem) return showFormError(problem.message, problem.field);

    const existing = state.products.find(p => p.id === raw.id) || null;
    const p = I.normalizeProduct(raw, { existing });
    try {
      await persist(p);
    } catch (err) {
      return showFormError(err && err.name === 'ConstraintError'
        ? 'Ya existe un producto con ese código.' : `No se pudo guardar: ${errMsg(err)}`);
    }
    el.productDialog.close();
    renderAll();
    toast(existing ? 'Producto actualizado' : 'Producto creado');
    if (state.rescanAfter) startLookupScan();
  }

  // ---------- Ajuste de stock ----------
  const ADJUST_LABELS = { in: 'Cantidad que entra', out: 'Cantidad que sale', set: 'Stock contado (total real)' };

  function adjustMode() {
    return el.adjustForm.elements.mode.value;
  }

  // Siempre se busca en la lista actual: el objeto se reemplaza al guardar.
  const adjustingProduct = () => state.products.find(o => o.id === state.adjustingId) || null;

  function updateAdjustPreview() {
    const p = adjustingProduct();
    if (!p) return;
    el.adjustQtyLabel.textContent = ADJUST_LABELS[adjustMode()];
    const qty = el.adjustForm.elements.qty.value;
    el.adjustError.hidden = true;
    if (qty.trim() === '') {
      el.adjustPreview.textContent = `Stock actual: ${num(p.stock)} ${p.unit}`;
      return;
    }
    const r = I.applyAdjustment(p.stock, adjustMode(), qty);
    el.adjustPreview.textContent = r.error
      ? r.error
      : `Stock: ${num(p.stock)} → ${num(r.stock)} ${p.unit}`;
    el.adjustPreview.classList.toggle('neg', !!r.error);
  }

  // Abre con el último tipo de ajuste usado y cantidad 1 seleccionada:
  // con Enter se aplica directo, o se escribe encima otra cantidad.
  function openAdjust(p, { rescan = false } = {}) {
    state.adjustingId = p.id;
    state.rescanAfter = rescan;
    const f = el.adjustForm.elements;
    el.adjustForm.reset();
    f.mode.value = state.lastAdjustMode;
    f.qty.value = state.lastAdjustMode === 'set' ? '' : '1';
    el.adjustProduct.textContent = p.sku ? `${p.name} (${p.sku})` : p.name;
    updateAdjustPreview();
    el.adjustDialog.showModal();
    f.qty.focus();
    f.qty.select();
  }

  async function applyStock(p, stock) {
    const updated = { ...p, stock, updatedAt: new Date().toISOString() };
    await persist(updated);
    renderStats();
    renderTable();
  }

  async function submitAdjust(e) {
    e.preventDefault();
    const p = adjustingProduct();
    if (!p) {
      el.adjustDialog.close();
      return toast('El producto ya no existe.', true);
    }
    const r = I.applyAdjustment(p.stock, adjustMode(), el.adjustForm.elements.qty.value);
    if (r.error) {
      el.adjustError.textContent = r.error;
      el.adjustError.hidden = false;
      el.adjustForm.elements.qty.focus();
      return;
    }
    try {
      await applyStock(p, r.stock);
    } catch (err) {
      el.adjustError.textContent = `No se pudo guardar: ${errMsg(err)}`;
      el.adjustError.hidden = false;
      return;
    }
    state.lastAdjustMode = adjustMode();
    el.adjustDialog.close();
    toast(`${p.name}: ${num(p.stock)} → ${num(r.stock)} ${p.unit}`);
    if (state.rescanAfter) startLookupScan();
  }

  // ---------- Escáner de códigos ----------
  const scan = {
    session: null,
    token: null, // identifica el arranque en curso, para ignorar uno viejo si se cerró antes
    onCode: null,
    cameraId: prefs.get('scanCamera', null),
    continuous: prefs.get('scanContinuous', false),
  };

  let audioCtx = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 1250;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.09);
    } catch { /* sin sonido */ }
    if (navigator.vibrate) navigator.vibrate(60);
  }

  function setScanStatus(text, isError = false) {
    el.scanStatus.textContent = text;
    el.scanStatus.classList.toggle('neg', isError);
  }

  // purpose: 'lookup' (buscar producto y ajustar stock) o 'sku' (rellenar el campo Código).
  function openScanner(purpose, onCode) {
    scan.onCode = onCode;
    el.scanManualInput.value = '';
    el.scanContinuousWrap.hidden = purpose !== 'lookup';
    el.scanContinuous.checked = scan.continuous;
    el.scanDialog.classList.remove('found');
    if (!el.scanDialog.open) el.scanDialog.showModal();
    if (!Scanner.isSupported()) {
      setScanStatus('Este navegador no permite usar la cámara. Puedes escribir el código abajo.', true);
      el.scanManualInput.focus();
      return;
    }
    startCamera();
  }

  async function startCamera() {
    stopCamera();
    const token = {};
    scan.token = token;
    setScanStatus('Abriendo la cámara…');
    try {
      const session = await Scanner.start({ video: el.scanVideo, deviceId: scan.cameraId, onResult: onScanned });
      if (scan.token !== token) { session.stop(); return; } // se cerró mientras arrancaba
      scan.session = session;
      setScanStatus('Apunta al código de barras dentro del recuadro.');
      await fillCameraSelect(session.deviceId);
    } catch (err) {
      if (scan.token !== token) return;
      // La cámara guardada ya no está: probar con la predeterminada.
      if (scan.cameraId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        scan.cameraId = null;
        prefs.set('scanCamera', null);
        return startCamera();
      }
      setScanStatus(Scanner.friendlyError(err) + ' También puedes escribir el código abajo.', true);
    }
  }

  function stopCamera() {
    scan.token = null;
    if (scan.session) {
      scan.session.stop();
      scan.session = null;
    }
  }

  function closeScanner() {
    stopCamera();
    if (el.scanDialog.open) el.scanDialog.close();
  }

  async function fillCameraSelect(activeId) {
    const cams = await Scanner.listCameras().catch(() => []);
    el.scanCamera.hidden = cams.length < 2;
    if (cams.length < 2) return;
    el.scanCamera.innerHTML = cams.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join('');
    if (activeId) el.scanCamera.value = activeId;
  }

  function deliverCode(code) {
    const onCode = scan.onCode;
    closeScanner();
    if (onCode) onCode(code);
  }

  function onScanned(code) {
    scan.session = null; // el escáner ya se detuvo solo
    beep();
    el.scanDialog.classList.add('found');
    setScanStatus(`Código leído: ${code}`);
    setTimeout(() => deliverCode(code), 250); // un instante para ver el recuadro en verde
  }

  function startLookupScan() {
    openScanner('lookup', (code) => lookupCode(code, { fromScanner: true }));
  }

  // Busca el producto por código: si existe, abre el ajuste; si no, ofrece crearlo.
  async function lookupCode(code, { fromScanner = false } = {}) {
    const clean = code.trim();
    if (!clean) return;
    const rescan = fromScanner && scan.continuous;
    const p = I.findBySku(state.products, clean);
    if (p) return openAdjust(p, { rescan });
    const create = await confirmAction(`No hay ningún producto con el código "${clean}". ¿Quieres crearlo?`,
      { okLabel: 'Crear producto', danger: false });
    if (create) openProductForm(null, { sku: clean, rescan });
    else if (rescan) startLookupScan();
  }

  async function quickAdjust(p, mode) {
    const r = I.applyAdjustment(p.stock, mode, 1);
    if (r.error) return toast(r.error, true);
    try {
      await applyStock(p, r.stock);
    } catch (err) {
      toast(`No se pudo actualizar: ${errMsg(err)}`, true);
    }
  }

  // ---------- Eliminar ----------
  async function deleteProduct(p) {
    if (!(await confirmAction(`¿Eliminar "${p.name}"? Esta acción no se puede deshacer.`))) return;
    try {
      await Store.deleteProduct(p.id);
    } catch (err) {
      return toast(`No se pudo eliminar: ${errMsg(err)}`, true);
    }
    state.products = state.products.filter(o => o.id !== p.id);
    renderAll();
    toast('Producto eliminado');
  }

  // ---------- Copias de seguridad y exportación ----------
  async function exportBackup() {
    const data = I.buildBackup(state.products, state.settings);
    try {
      const saved = await Platform.saveFile({
        name: `inventario-copia-${today()}.json`,
        content: JSON.stringify(data, null, 2),
        mime: 'application/json',
      });
      if (saved) toast(`Copia de seguridad guardada (${state.products.length} productos)`);
    } catch (err) {
      toast(`No se pudo guardar la copia: ${errMsg(err)}`, true);
    }
  }

  async function exportCsv() {
    const list = visibleProducts();
    try {
      const saved = await Platform.saveFile({
        name: `inventario-${today()}.csv`,
        content: I.buildCsv(list),
        mime: 'text/csv;charset=utf-8',
      });
      if (saved) toast(`CSV guardado (${list.length} productos)`);
    } catch (err) {
      toast(`No se pudo guardar el CSV: ${errMsg(err)}`, true);
    }
  }

  async function restoreBackup() {
    let file;
    try {
      file = await Platform.openFile({ accept: '.json,application/json' });
    } catch (err) {
      return toast(`No se pudo leer el archivo: ${errMsg(err)}`, true);
    }
    if (!file) return;

    let data;
    try {
      data = JSON.parse(file.text);
    } catch {
      return toast('El archivo no es una copia de seguridad válida.', true);
    }
    const result = I.prepareImport(data);
    if (result.error) return toast(result.error, true);

    let msg = `Se reemplazarán los ${state.products.length} productos actuales por los ${result.products.length} de la copia.`;
    if (result.skipped) msg += ` ${result.skipped} registro(s) de la copia no tienen nombre y se omitirán.`;
    if (!(await confirmAction(msg + ' ¿Continuar?'))) return;

    try {
      await Store.replaceAllProducts(result.products);
      if (result.settings) await Store.saveSettings(result.settings);
    } catch (err) {
      return toast(`No se pudo restaurar: ${errMsg(err)}. No se cambió nada.`, true);
    }
    state.products = result.products;
    if (result.settings) state.settings = result.settings;
    renderAll();
    toast(`Restaurados ${result.products.length} productos` +
      (result.skipped ? ` (${result.skipped} omitidos por no tener nombre)` : ''));
  }

  // ---------- Ajustes ----------
  function openSettings() {
    el.settingsForm.elements.storeName.value = state.settings.storeName;
    el.settingsForm.elements.currency.value = state.settings.currency;
    el.settingsDialog.showModal();
    showDesktopDataInfo();
  }

  // Solo en la app de escritorio: dónde están los datos y botón para abrir la carpeta.
  async function showDesktopDataInfo() {
    const api = window.desktopAPI;
    const box = $('#desktop-data');
    if (!api || !api.getInfo) { box.hidden = true; return; }
    try {
      const info = await api.getInfo();
      $('#desktop-data-path').textContent = info.dataDir;
      box.hidden = false;
    } catch {
      box.hidden = true;
    }
  }

  async function saveSettings(e) {
    e.preventDefault();
    const f = el.settingsForm.elements;
    if (!f.storeName.value.trim() || !f.currency.value.trim()) return;
    const settings = I.normalizeSettings({ storeName: f.storeName.value, currency: f.currency.value });
    try {
      await Store.saveSettings(settings);
    } catch (err) {
      return toast(`No se pudieron guardar los ajustes: ${errMsg(err)}`, true);
    }
    state.settings = settings;
    el.settingsDialog.close();
    renderAll();
    toast('Ajustes guardados');
  }

  // ---------- Eventos ----------
  function bindEvents() {
    $('#btn-new').addEventListener('click', () => openProductForm(null));
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-open-data').addEventListener('click', () => {
      window.desktopAPI.openDataFolder().catch(err => toast(`No se pudo abrir la carpeta: ${errMsg(err)}`, true));
    });
    $('#btn-backup').addEventListener('click', exportBackup);
    $('#btn-export-csv').addEventListener('click', exportCsv);
    $('#btn-restore').addEventListener('click', restoreBackup);

    el.productForm.addEventListener('submit', saveProduct);
    el.categorySelect.addEventListener('change', () => toggleNewCategory());

    // Escáner
    $('#btn-scan').addEventListener('click', startLookupScan);
    $('#btn-scan-sku').addEventListener('click', scanIntoSkuField);
    $('#scan-cancel').addEventListener('click', closeScanner);
    el.scanDialog.addEventListener('cancel', stopCamera); // tecla Esc
    el.scanDialog.addEventListener('close', stopCamera);
    el.scanCamera.addEventListener('change', () => {
      scan.cameraId = el.scanCamera.value;
      prefs.set('scanCamera', scan.cameraId);
      startCamera();
    });
    el.scanContinuous.addEventListener('change', () => {
      scan.continuous = el.scanContinuous.checked;
      prefs.set('scanContinuous', scan.continuous);
    });
    el.scanManual.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = el.scanManualInput.value.trim();
      if (code) deliverCode(code);
    });
    // El recuadro guía debe coincidir con la imagen real (algunas cámaras son 4:3).
    el.scanVideo.addEventListener('loadedmetadata', () => {
      const { videoWidth: w, videoHeight: h } = el.scanVideo;
      if (w && h) el.scanView.style.aspectRatio = `${w} / ${h}`;
    });

    // Lector USB o código escrito en el buscador + Enter: igual que escanear con la cámara.
    el.search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const code = el.search.value.trim();
      if (I.findBySku(state.products, code) || I.looksLikeBarcode(code)) {
        e.preventDefault();
        el.search.select(); // el próximo escaneo reemplaza el texto
        lookupCode(code);
      }
    });
    el.productForm.addEventListener('input', (e) => {
      if (['cost', 'price', 'unit'].includes(e.target.name)) updatePricePreview();
    });
    el.adjustForm.addEventListener('submit', submitAdjust);
    el.adjustForm.addEventListener('input', updateAdjustPreview);
    el.adjustForm.addEventListener('change', () => {
      updateAdjustPreview();
      el.adjustForm.elements.qty.focus();
    });
    el.settingsForm.addEventListener('submit', saveSettings);
    document.querySelectorAll('[data-close]').forEach(b =>
      b.addEventListener('click', () => b.closest('dialog').close()));

    el.search.addEventListener('input', renderTable);
    el.filterCategory.addEventListener('change', renderTable);
    el.filterStatus.addEventListener('change', renderTable);

    // Las tarjetas "Stock bajo" y "Sin stock" filtran la tabla (clic de nuevo para quitar).
    document.querySelectorAll('.stat[data-status]').forEach(card => card.addEventListener('click', () => {
      const s = card.dataset.status;
      el.filterStatus.value = el.filterStatus.value === s ? '' : s;
      renderTable();
    }));

    document.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
      const key = th.dataset.sort;
      state.sort = { key, dir: state.sort.key === key && state.sort.dir === 'asc' ? 'desc' : 'asc' };
      renderTable();
    }));

    el.body.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const p = state.products.find(o => o.id === btn.closest('tr').dataset.id);
      if (!p) return;
      const actions = {
        inc: () => quickAdjust(p, 'in'),
        dec: () => quickAdjust(p, 'out'),
        adjust: () => openAdjust(p),
        edit: () => openProductForm(p),
        delete: () => deleteProduct(p),
      };
      actions[btn.dataset.action]();
    });

    // Atajo: "/" enfoca el buscador (útil con lector de código de barras).
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !e.target.closest('input, textarea, select, dialog')) {
        e.preventDefault();
        el.search.focus();
      }
    });
  }

  // ---------- Inicio ----------
  async function init() {
    bindEvents();
    if (!Store) {
      toast(`No se pudo abrir el almacenamiento: ${errMsg(window.StoreError)}`, true);
      renderAll();
      return;
    }
    $('#demo-banner').hidden = Store.kind !== 'demo';
    try {
      const [products, settings] = await Promise.all([Store.listProducts(), Store.getSettings()]);
      state.products = products;
      if (settings) state.settings = I.normalizeSettings(settings);
    } catch (err) {
      toast(`No se pudo abrir la base de datos: ${errMsg(err)}`, true);
    }
    renderAll();
  }

  init();
})();
