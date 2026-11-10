// Pruebas del almacenamiento en archivo de la versión de escritorio.
// Ejecutar con: npm test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFileStore } = require('../electron/file-store');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'inventario-test-'));
const prod = (id, sku, name = 'Producto ' + id) => ({ id, sku, name, stock: 1, cost: 1, price: 2 });

test('carpeta nueva: empieza vacía y guarda en disco', async () => {
  const dir = tmpDir();
  const s = createFileStore(dir);
  assert.equal((await s.load()).status, 'new');
  assert.deepEqual(await s.listProducts(), []);
  await s.saveProduct(prod('1', 'A'));
  await s.saveSettings({ storeName: 'Kiosco', currency: '$' });
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'inventario.json'), 'utf8'));
  assert.equal(onDisk.products[0].sku, 'A');
  assert.equal(onDisk.settings.storeName, 'Kiosco');
  assert.ok(!fs.existsSync(path.join(dir, 'inventario.json.tmp')), 'no deja el temporal');
});

test('los datos siguen ahí al volver a abrir, y se hace la copia del día', async () => {
  const dir = tmpDir();
  const a = createFileStore(dir);
  await a.load();
  await a.saveProduct(prod('1', 'A'));
  await a.saveProduct({ ...prod('1', 'A'), stock: 9 }); // actualizar
  const b = createFileStore(dir);
  assert.equal((await b.load()).status, 'ok');
  const list = await b.listProducts();
  assert.equal(list.length, 1);
  assert.equal(list[0].stock, 9);
  const backups = fs.readdirSync(path.join(dir, 'copias-automaticas'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^inventario-\d{4}-\d{2}-\d{2}\.json$/);
});

test('código repetido: se rechaza y no cambia nada (ni en memoria ni en disco)', async () => {
  const dir = tmpDir();
  const s = createFileStore(dir);
  await s.load();
  await s.saveProduct(prod('1', 'A'));
  await assert.rejects(s.saveProduct(prod('2', 'A')), { name: 'ConstraintError' });
  await assert.rejects(s.replaceAllProducts([prod('3', 'B'), prod('4', 'B')]), { name: 'ConstraintError' });
  assert.deepEqual((await s.listProducts()).map(p => p.id), ['1']);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'inventario.json'), 'utf8'));
  assert.deepEqual(onDisk.products.map(p => p.id), ['1']);
});

test('muchos cambios seguidos se guardan todos, en orden', async () => {
  const dir = tmpDir();
  const s = createFileStore(dir);
  await s.load();
  await Promise.all(Array.from({ length: 50 }, (_, i) => s.saveProduct(prod(String(i), 'S' + i))));
  await s.deleteProduct('0');
  const reopened = createFileStore(dir);
  await reopened.load();
  assert.equal((await reopened.listProducts()).length, 49);
});

test('archivo dañado: se aparta y se recupera la copia automática', async () => {
  const dir = tmpDir();
  const a = createFileStore(dir);
  await a.load();
  await a.saveProduct(prod('1', 'A', 'Arroz'));
  await createFileStore(dir).load(); // genera la copia del día con "Arroz"
  fs.writeFileSync(path.join(dir, 'inventario.json'), '{ esto no es json');
  const b = createFileStore(dir);
  const r = await b.load();
  assert.equal(r.status, 'recovered');
  assert.equal((await b.listProducts())[0].name, 'Arroz');
  assert.ok(fs.existsSync(r.damaged), 'el archivo dañado se conserva aparte');
  assert.equal(fs.readFileSync(r.damaged, 'utf8'), '{ esto no es json');
});

test('archivo dañado sin copias: empieza vacío pero no borra el dañado', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'inventario.json'), 'basura');
  const s = createFileStore(dir);
  const r = await s.load();
  assert.equal(r.status, 'damaged');
  assert.deepEqual(await s.listProducts(), []);
  assert.equal(fs.readFileSync(r.damaged, 'utf8'), 'basura');
});

test('se guardan como máximo 30 copias automáticas', async () => {
  const dir = tmpDir();
  const backupDir = path.join(dir, 'copias-automaticas');
  fs.mkdirSync(backupDir, { recursive: true });
  for (let d = 1; d <= 35; d++) {
    fs.writeFileSync(path.join(backupDir, `inventario-2020-01-${String(d).padStart(2, '0')}.json`), '{"products":[]}');
  }
  fs.writeFileSync(path.join(dir, 'inventario.json'), '{"products":[]}');
  await createFileStore(dir).load();
  const left = fs.readdirSync(backupDir).sort();
  assert.equal(left.length, 30);
  assert.ok(!left.includes('inventario-2020-01-01.json'), 'borra las más viejas');
});
