// Lógica de negocio del inventario.
// No toca la interfaz ni el almacenamiento: solo recibe y devuelve datos.
// Así se puede reutilizar tal cual en la versión de escritorio (incluso en Node).
(function (global) {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({ storeName: 'Mi Tienda', currency: '$' });
  const NUMERIC_FIELDS = ['cost', 'price', 'stock', 'minStock'];
  const NUMBER_RE = /^-?\d+([.,]\d+)?$/;

  const str = (v) => (v == null ? '' : String(v)).trim();

  // Redondeo para evitar errores tipo 0.1 + 0.2 = 0.30000000000000004
  function round(n, decimals = 3) {
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
  }

  // Acepta "2,25", "2.25" o un número. Vacío = 0. Texto inválido = NaN.
  function parseNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    const s = str(v);
    if (s === '') return 0;
    if (!NUMBER_RE.test(s)) return NaN;
    return parseFloat(s.replace(',', '.'));
  }

  function newId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  const validDate = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

  // ---------- Productos ----------

  // Convierte datos crudos (formulario o archivo importado) en un producto limpio.
  // keepDates: conserva createdAt/updatedAt del origen (para restaurar copias).
  function normalizeProduct(raw, { existing = null, keepDates = false } = {}) {
    const now = new Date().toISOString();
    const num = (v) => {
      const n = parseNumber(v);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    };
    return {
      id: str(raw.id) || (existing && existing.id) || newId(),
      sku: str(raw.sku) || undefined, // undefined = sin código
      name: str(raw.name),
      category: str(raw.category),
      unit: str(raw.unit) || 'unidad',
      cost: round(num(raw.cost), 4),
      price: round(num(raw.price), 4),
      stock: round(num(raw.stock)),
      minStock: round(num(raw.minStock)),
      notes: str(raw.notes),
      createdAt: (keepDates && validDate(raw.createdAt)) || (existing && existing.createdAt) || now,
      updatedAt: (keepDates && validDate(raw.updatedAt)) || now,
    };
  }

  // Devuelve { field, message } con el primer error, o null si todo está bien.
  function validateProduct(raw, products = []) {
    if (!str(raw.name)) return { field: 'name', message: 'El nombre es obligatorio.' };
    for (const field of NUMERIC_FIELDS) {
      const n = parseNumber(raw[field]);
      if (Number.isNaN(n)) {
        return { field, message: `"${str(raw[field])}" no es un número válido. Usa solo números, con coma o punto para los decimales.` };
      }
      if (n < 0) return { field, message: 'Los números no pueden ser negativos.' };
    }
    const sku = str(raw.sku);
    if (sku) {
      const id = str(raw.id);
      const dup = products.find(o => o.id !== id && str(o.sku).toLowerCase() === sku.toLowerCase());
      if (dup) return { field: 'sku', message: `El código "${sku}" ya lo usa "${dup.name}".` };
    }
    return null;
  }

  // 'out' = sin stock, 'low' = en o bajo el mínimo, 'ok' = normal.
  function stockStatus(p) {
    if (p.stock <= 0) return 'out';
    if (p.minStock > 0 && p.stock <= p.minStock) return 'low';
    return 'ok';
  }

  // Recargo: cuánto se gana respecto al costo. (precio - costo) / costo
  function markup(p) {
    return p.cost > 0 ? ((p.price - p.cost) / p.cost) * 100 : null;
  }

  // Margen: qué parte del precio de venta es ganancia. (precio - costo) / precio
  function margin(p) {
    return p.price > 0 ? ((p.price - p.cost) / p.price) * 100 : null;
  }

  function totals(products) {
    const t = { count: products.length, costValue: 0, priceValue: 0, low: 0, out: 0 };
    for (const p of products) {
      t.costValue += p.stock * p.cost;
      t.priceValue += p.stock * p.price;
      const s = stockStatus(p);
      if (s === 'low') t.low++;
      if (s === 'out') t.out++;
    }
    t.costValue = round(t.costValue, 2);
    t.priceValue = round(t.priceValue, 2);
    return t;
  }

  // ---------- Ajustes de stock ----------

  const ADJUST_MODES = ['in', 'out', 'set'];

  // mode: 'in' (entrada, suma), 'out' (salida, resta), 'set' (fija el total contado).
  // Devuelve { stock } con el nuevo valor, o { error }.
  function applyAdjustment(current, mode, qtyRaw) {
    if (!ADJUST_MODES.includes(mode)) return { error: 'Tipo de ajuste desconocido.' };
    if (str(qtyRaw) === '') return { error: 'Escribe una cantidad.' };
    const qty = parseNumber(qtyRaw);
    if (Number.isNaN(qty)) return { error: `"${str(qtyRaw)}" no es un número válido.` };
    if (qty < 0) return { error: 'La cantidad no puede ser negativa.' };
    if (mode === 'set') return { stock: round(qty) };
    if (qty === 0) return { error: 'La cantidad debe ser mayor que 0.' };
    if (mode === 'in') return { stock: round(current + qty) };
    const next = round(current - qty);
    if (next < 0) return { error: `No alcanza: solo hay ${current.toLocaleString('es')} en stock.` };
    return { stock: next };
  }

  // ---------- Búsqueda y orden ----------

  function matchesFilter(p, { query = '', category = '', status = '' } = {}) {
    if (category && p.category !== category) return false;
    if (status) {
      const s = stockStatus(p);
      if (status === 'alert' && s === 'ok') return false;
      if ((status === 'low' || status === 'out') && s !== status) return false;
    }
    const q = str(query).toLowerCase();
    if (!q) return true;
    return [p.name, p.sku, p.category].some(v => str(v).toLowerCase().includes(q));
  }

  // Producto con ese código exacto (sin importar mayúsculas ni espacios alrededor), o null.
  function findBySku(products, code) {
    const key = str(code).toLowerCase();
    if (!key) return null;
    return products.find(p => str(p.sku).toLowerCase() === key) || null;
  }

  // ¿Parece un código de barras? (solo números, 6 o más dígitos: EAN, UPC, ITF…)
  const looksLikeBarcode = (s) => /^\d{6,}$/.test(str(s));

  const SORT_GETTERS = {
    markup: (p) => markup(p) ?? -Infinity,
    margin: (p) => margin(p) ?? -Infinity,
  };

  function sortProducts(list, key, dir = 'asc') {
    const get = SORT_GETTERS[key] || ((p) => p[key]);
    const factor = dir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => {
      const va = get(a), vb = get(b);
      if (typeof va === 'number' || typeof vb === 'number') {
        const na = va ?? 0, nb = vb ?? 0;
        return (na === nb ? 0 : na < nb ? -1 : 1) * factor;
      }
      return str(va).localeCompare(str(vb), 'es', { sensitivity: 'base', numeric: true }) * factor;
    });
  }

  // ---------- Categorías ----------

  // Clave para comparar sin importar mayúsculas, tildes ni espacios de más.
  const categoryKey = (s) => str(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').toLowerCase();

  // Categorías en uso, sin repetir y ordenadas.
  function listCategories(products) {
    const byKey = new Map();
    for (const p of products) {
      const c = str(p.category);
      if (c && !byKey.has(categoryKey(c))) byKey.set(categoryKey(c), c);
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }

  // Si el nombre ya existe escrito de otra forma ("lacteos" vs "Lácteos"), devuelve el existente.
  function resolveCategory(name, categories) {
    const clean = str(name).replace(/\s+/g, ' ');
    if (!clean) return '';
    return categories.find(c => categoryKey(c) === categoryKey(clean)) || clean;
  }

  // ---------- Ajustes generales ----------

  function normalizeSettings(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
      storeName: str(s.storeName).slice(0, 60) || DEFAULT_SETTINGS.storeName,
      currency: str(s.currency).slice(0, 5) || DEFAULT_SETTINGS.currency,
    };
  }

  // ---------- Copias de seguridad y exportación ----------

  function buildBackup(products, settings) {
    return { app: 'inventario', version: 1, exportedAt: new Date().toISOString(), settings, products };
  }

  // Valida una copia de seguridad antes de restaurarla.
  // Devuelve { products, skipped, settings } o { error }.
  function prepareImport(data) {
    const list = Array.isArray(data) ? data : data && data.products;
    if (!Array.isArray(list)) return { error: 'El archivo no contiene productos.' };

    const products = [];
    const ids = new Set();
    const skus = new Map();
    let skipped = 0;
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') { skipped++; continue; }
      const p = normalizeProduct(raw, { keepDates: true });
      if (!p.name) { skipped++; continue; }
      if (ids.has(p.id)) p.id = newId(); // id repetido: se le da uno nuevo para no pisar al otro
      ids.add(p.id);
      if (p.sku) {
        const key = p.sku.toLowerCase();
        if (skus.has(key)) {
          return { error: `El código "${p.sku}" está repetido en la copia ("${skus.get(key)}" y "${p.name}").` };
        }
        skus.set(key, p.name);
      }
      products.push(p);
    }
    const settings = !Array.isArray(data) && data.settings && typeof data.settings === 'object'
      ? normalizeSettings(data.settings) : null;
    return { products, skipped, settings };
  }

  const CSV_COLUMNS = [
    ['sku', 'Código'], ['name', 'Nombre'], ['category', 'Categoría'], ['unit', 'Unidad'],
    ['stock', 'Stock'], ['minStock', 'Stock mínimo'], ['cost', 'Costo'], ['price', 'Precio'], ['notes', 'Notas'],
  ];

  // CSV con ";" y coma decimal, que es lo que espera Excel en español.
  function buildCsv(products) {
    const cell = (v) => {
      let s = typeof v === 'number' ? String(v).replace('.', ',') : str(v);
      // Evita que Excel interprete el texto como fórmula.
      if (typeof v !== 'number' && /^[=+\-@]/.test(s)) s = "'" + s;
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [CSV_COLUMNS.map(c => c[1]).join(';')];
    for (const p of products) rows.push(CSV_COLUMNS.map(([k]) => cell(p[k])).join(';'));
    return '﻿' + rows.join('\r\n'); // BOM para que Excel reconozca los acentos
  }

  const api = {
    DEFAULT_SETTINGS, round, parseNumber, newId,
    normalizeProduct, validateProduct, stockStatus, markup, margin, totals,
    applyAdjustment, matchesFilter, sortProducts, listCategories, resolveCategory,
    findBySku, looksLikeBarcode,
    normalizeSettings, buildBackup, prepareImport, buildCsv,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Inventory = api;
})(typeof window !== 'undefined' ? window : globalThis);
