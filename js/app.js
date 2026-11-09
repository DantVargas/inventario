// Lógica de la interfaz: productos y stock.
(() => {
  const state = {
    products: [],
    settings: { storeName: 'Mi Tienda', currency: '$' },
    sort: { key: 'name', dir: 'asc' },
  };

  const $ = (sel) => document.querySelector(sel);
  const el = {
    storeName: $('#store-name'),
    body: $('#products-body'),
    empty: $('#empty-msg'),
    search: $('#search'),
    filterCategory: $('#filter-category'),
    filterLow: $('#filter-low'),
    categoryList: $('#category-list'),
    productDialog: $('#product-dialog'),
    productForm: $('#product-form'),
    productTitle: $('#product-dialog-title'),
    formError: $('#form-error'),
    settingsDialog: $('#settings-dialog'),
    settingsForm: $('#settings-form'),
    confirmDialog: $('#confirm-dialog'),
    confirmText: $('#confirm-text'),
    toast: $('#toast'),
  };

  // ---------- Utilidades ----------
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const numFmt = new Intl.NumberFormat('es', { maximumFractionDigits: 3 });
  const moneyFmt = new Intl.NumberFormat('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n) => `${state.settings.currency} ${moneyFmt.format(n || 0)}`;
  const toNum = (v) => {
    const n = parseFloat(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  // Redondeo para evitar errores tipo 0.1 + 0.2 = 0.30000000000000004
  const round = (n) => Math.round(n * 1000) / 1000;
  const newId = () => (crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const isLow = (p) => p.minStock > 0 && p.stock <= p.minStock;
  const margin = (p) => (p.cost > 0 ? ((p.price - p.cost) / p.cost) * 100 : null);

  let toastTimer;
  function toast(msg, isError = false) {
    el.toast.textContent = msg;
    el.toast.classList.toggle('error', isError);
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2800);
  }

  function confirmAction(text) {
    return new Promise(resolve => {
      el.confirmText.textContent = text;
      el.confirmDialog.returnValue = '';
      el.confirmDialog.addEventListener('close', () => resolve(el.confirmDialog.returnValue === 'yes'), { once: true });
      el.confirmDialog.showModal();
    });
  }

  // Normaliza un producto (del formulario o de una copia importada).
  function normalize(raw, existing) {
    const now = new Date().toISOString();
    const sku = String(raw.sku ?? '').trim();
    return {
      id: raw.id || existing?.id || newId(),
      sku: sku || undefined, // undefined = sin código (no choca en el índice único)
      name: String(raw.name ?? '').trim(),
      category: String(raw.category ?? '').trim(),
      unit: String(raw.unit ?? '').trim() || 'unidad',
      cost: Math.max(0, toNum(raw.cost)),
      price: Math.max(0, toNum(raw.price)),
      stock: Math.max(0, round(toNum(raw.stock))),
      minStock: Math.max(0, toNum(raw.minStock)),
      notes: String(raw.notes ?? '').trim(),
      createdAt: raw.createdAt || existing?.createdAt || now,
      updatedAt: now,
    };
  }

  // ---------- Render ----------
  function filtered() {
    const q = el.search.value.trim().toLowerCase();
    const cat = el.filterCategory.value;
    const onlyLow = el.filterLow.checked;
    const list = state.products.filter(p => {
      if (cat && p.category !== cat) return false;
      if (onlyLow && !isLow(p)) return false;
      if (!q) return true;
      return [p.name, p.sku, p.category].some(v => (v || '').toLowerCase().includes(q));
    });
    const { key, dir } = state.sort;
    const factor = dir === 'asc' ? 1 : -1;
    const val = (p) => (key === 'margin' ? (margin(p) ?? -Infinity) : p[key]);
    return list.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (typeof va === 'number' || typeof vb === 'number') return ((va ?? 0) - (vb ?? 0)) * factor;
      return String(va ?? '').localeCompare(String(vb ?? ''), 'es', { sensitivity: 'base', numeric: true }) * factor;
    });
  }

  function renderStats() {
    const ps = state.products;
    $('#stat-products').textContent = numFmt.format(ps.length);
    $('#stat-units').textContent = numFmt.format(round(ps.reduce((s, p) => s + p.stock, 0)));
    $('#stat-cost').textContent = money(ps.reduce((s, p) => s + p.stock * p.cost, 0));
    $('#stat-price').textContent = money(ps.reduce((s, p) => s + p.stock * p.price, 0));
    $('#stat-low').textContent = numFmt.format(ps.filter(isLow).length);
  }

  function renderCategories() {
    const cats = [...new Set(state.products.map(p => p.category).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es'));
    const current = el.filterCategory.value;
    el.filterCategory.innerHTML = '<option value="">Todas las categorías</option>' +
      cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    el.filterCategory.value = cats.includes(current) ? current : '';
    el.categoryList.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join('');
  }

  function renderTable() {
    const list = filtered();
    el.body.innerHTML = list.map(p => {
      const m = margin(p);
      const mHtml = m === null ? '<span class="muted">—</span>'
        : `<span class="${m < 0 ? 'margin-neg' : 'margin-pos'}">${numFmt.format(Math.round(m))}%</span>`;
      return `
        <tr data-id="${p.id}" class="${isLow(p) ? 'low' : ''}">
          <td>${p.sku ? escapeHtml(p.sku) : '<span class="muted">—</span>'}</td>
          <td class="name">${escapeHtml(p.name)}</td>
          <td>${p.category ? escapeHtml(p.category) : '<span class="muted">—</span>'}</td>
          <td class="num">
            <span class="stock-cell">
              <button class="btn small" data-action="dec" title="Restar 1">−</button>
              <span class="${isLow(p) ? 'badge-low' : ''}">${numFmt.format(p.stock)}</span>
              <span class="unit">${escapeHtml(p.unit)}</span>
              <button class="btn small" data-action="inc" title="Sumar 1">+</button>
            </span>
          </td>
          <td class="num">${p.minStock ? numFmt.format(p.minStock) : '<span class="muted">—</span>'}</td>
          <td class="num">${money(p.cost)}</td>
          <td class="num">${money(p.price)}</td>
          <td class="num">${mHtml}</td>
          <td class="num">
            <button class="btn link" data-action="edit">Editar</button>
            <button class="btn link del" data-action="delete">Eliminar</button>
          </td>
        </tr>`;
    }).join('');

    if (state.products.length === 0) {
      el.empty.textContent = 'Todavía no hay productos. Pulsa "+ Nuevo producto" para empezar.';
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

  // ---------- Productos ----------
  function openProductForm(product) {
    const f = el.productForm;
    f.reset();
    el.formError.hidden = true;
    el.productTitle.textContent = product ? 'Editar producto' : 'Nuevo producto';
    const p = product || { unit: 'unidad' };
    for (const name of ['id', 'sku', 'name', 'category', 'unit', 'cost', 'price', 'stock', 'minStock', 'notes']) {
      f.elements[name].value = p[name] ?? '';
    }
    el.productDialog.showModal();
    f.elements[product ? 'name' : 'sku'].focus();
  }

  function showFormError(msg, field) {
    el.formError.textContent = msg;
    el.formError.hidden = false;
    if (field) el.productForm.elements[field].focus();
  }

  async function saveProduct(e) {
    e.preventDefault();
    const raw = Object.fromEntries(new FormData(el.productForm));
    const existing = state.products.find(p => p.id === raw.id);
    const p = normalize(raw, existing);

    if (!p.name) return showFormError('El nombre es obligatorio.', 'name');
    for (const f of ['cost', 'price', 'stock', 'minStock']) {
      const v = raw[f].trim();
      if (v === '') continue;
      if (!/^-?\d+([.,]\d+)?$/.test(v)) return showFormError(`"${v}" no es un número válido.`, f);
      if (toNum(v) < 0) return showFormError('Los números no pueden ser negativos.', f);
    }
    if (p.sku) {
      const dup = state.products.find(o => o.id !== p.id && (o.sku || '').toLowerCase() === p.sku.toLowerCase());
      if (dup) return showFormError(`El código "${p.sku}" ya lo usa "${dup.name}".`, 'sku');
    }

    try {
      await DB.putProduct(p);
    } catch (err) {
      return showFormError(err?.name === 'ConstraintError'
        ? 'Ya existe un producto con ese código.' : `No se pudo guardar: ${err?.message || err}`);
    }
    if (existing) Object.assign(existing, p); else state.products.push(p);
    el.productDialog.close();
    renderAll();
    toast(existing ? 'Producto actualizado' : 'Producto creado');
  }

  async function adjustStock(p, delta) {
    const next = round(p.stock + delta);
    if (next < 0) return toast('El stock no puede ser negativo', true);
    const updated = { ...p, stock: next, updatedAt: new Date().toISOString() };
    try {
      await DB.putProduct(updated);
      Object.assign(p, updated);
      renderStats();
      renderTable();
    } catch (err) {
      toast(`No se pudo actualizar: ${err?.message || err}`, true);
    }
  }

  async function deleteProduct(p) {
    if (!(await confirmAction(`¿Eliminar "${p.name}"? Esta acción no se puede deshacer.`))) return;
    await DB.deleteProduct(p.id);
    state.products = state.products.filter(o => o.id !== p.id);
    renderAll();
    toast('Producto eliminado');
  }

  // ---------- Exportar / importar ----------
  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const today = () => new Date().toISOString().slice(0, 10);

  function exportBackup() {
    const data = { app: 'inventario', version: 1, exportedAt: new Date().toISOString(),
      settings: state.settings, products: state.products };
    download(`inventario-copia-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('Copia de seguridad descargada');
  }

  function exportCsv() {
    const cols = [['sku', 'Código'], ['name', 'Nombre'], ['category', 'Categoría'], ['unit', 'Unidad'],
      ['stock', 'Stock'], ['minStock', 'Stock mínimo'], ['cost', 'Costo'], ['price', 'Precio'], ['notes', 'Notas']];
    const cell = (v) => {
      let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
      // Evita que Excel interprete el texto como fórmula.
      if (/^[=+\-@]/.test(s) && typeof v !== 'number') s = "'" + s;
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [cols.map(c => c[1]).join(';'),
      ...filtered().map(p => cols.map(([k]) => cell(p[k])).join(';'))];
    // BOM para que Excel reconozca los acentos.
    download(`inventario-${today()}.csv`, '﻿' + rows.join('\r\n'), 'text/csv;charset=utf-8');
    toast('CSV descargado');
  }

  async function restoreBackup(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return toast('El archivo no es una copia de seguridad válida', true);
    }
    const list = Array.isArray(data) ? data : data?.products;
    if (!Array.isArray(list)) return toast('El archivo no contiene productos', true);

    const products = list.map(r => normalize(r)).filter(p => p.name);
    const seen = new Set();
    for (const p of products) {
      const key = p.sku?.toLowerCase();
      if (key && seen.has(key)) return toast(`Código repetido en la copia: "${p.sku}"`, true);
      if (key) seen.add(key);
    }
    if (!(await confirmAction(`Se reemplazarán los ${state.products.length} productos actuales por los ${products.length} de la copia. ¿Continuar?`))) return;

    await DB.replaceAllProducts(products);
    state.products = products;
    if (data.settings?.storeName) {
      state.settings = { ...state.settings, ...data.settings };
      await DB.setSetting('general', state.settings);
    }
    renderAll();
    toast(`Restaurados ${products.length} productos`);
  }

  // ---------- Ajustes ----------
  function openSettings() {
    el.settingsForm.elements.storeName.value = state.settings.storeName;
    el.settingsForm.elements.currency.value = state.settings.currency;
    el.settingsDialog.showModal();
  }

  async function saveSettings(e) {
    e.preventDefault();
    const f = el.settingsForm.elements;
    const storeName = f.storeName.value.trim();
    const currency = f.currency.value.trim();
    if (!storeName || !currency) return;
    state.settings = { ...state.settings, storeName, currency };
    await DB.setSetting('general', state.settings);
    el.settingsDialog.close();
    renderAll();
    toast('Ajustes guardados');
  }

  // ---------- Eventos ----------
  function bindEvents() {
    $('#btn-new').addEventListener('click', () => openProductForm(null));
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-backup').addEventListener('click', exportBackup);
    $('#btn-export-csv').addEventListener('click', exportCsv);
    $('#input-restore').addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) restoreBackup(file);
    });

    el.productForm.addEventListener('submit', saveProduct);
    el.settingsForm.addEventListener('submit', saveSettings);
    document.querySelectorAll('[data-close]').forEach(b =>
      b.addEventListener('click', () => b.closest('dialog').close()));

    el.search.addEventListener('input', renderTable);
    el.filterCategory.addEventListener('change', renderTable);
    el.filterLow.addEventListener('change', renderTable);

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
      ({ inc: () => adjustStock(p, 1), dec: () => adjustStock(p, -1),
         edit: () => openProductForm(p), delete: () => deleteProduct(p) })[btn.dataset.action]();
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
    try {
      const [products, settings] = await Promise.all([DB.getAllProducts(), DB.getSetting('general')]);
      state.products = products;
      if (settings) state.settings = { ...state.settings, ...settings };
    } catch (err) {
      toast(`No se pudo abrir la base de datos: ${err?.message || err}`, true);
    }
    renderAll();
  }

  init();
})();
