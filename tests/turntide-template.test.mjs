import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTurntideLayout, appendTurntideAssets, fitTurntideSizeData, turntideSizeDefaults } from '../turntide-template.mjs';
import { mapSizeData } from '../core.mjs';

const manifest = JSON.parse(readFileSync(new URL('../assets/turntide-template/manifest.json', import.meta.url), 'utf8'));
const geometry = JSON.parse(readFileSync(new URL('../assets/turntide-template/geometry.json', import.meta.url), 'utf8'));
const idFactory = () => { let number = 0; return () => `four-${++number}`; };
const options = () => ({ manifest, geometry, createId: idFactory() });
const assets = ['hero', 'details', 'models', 'footer'].flatMap(group => manifest[group].map((asset, index) => ({ ...asset, id: `${group}-${index}`, group, assetFile: asset.asset, sourceX: asset.frame?.x || 0, sourceCropWidth: asset.width })));

test('complete four-block template keeps source order and four individual detail frames', () => {
  const layout = buildTurntideLayout(assets, options());
  const cover = layout.elements.find(element => element.role === 'cover');
  const size = layout.elements.find(element => element.type === 'size');
  const details = layout.elements.filter(element => element.role === 'details');
  const models = layout.elements.filter(element => element.role === 'models');
  const footer = layout.elements.filter(element => element.role === 'footer');
  assert.equal(details.length, 4); assert.equal(models.length, 9); assert.equal(footer.length, 1);
  assert.ok(cover.y + cover.h <= size.y);
  assert.ok(details.every(element => element.y >= size.y + size.h));
  assert.ok(models.every(element => element.y >= Math.max(...details.map(item => item.y + item.h))));
  assert.ok(footer.every(element => element.y >= Math.max(...models.map(item => item.y + item.h))));
  for (const [index, detail] of details.entries()) {
    const source = manifest.layout.details.frames[index], scale = 1440 / manifest.layout.details.sourceWidth;
    assert.equal(detail.x, source.x * scale); assert.equal(detail.w, source.w * scale); assert.equal(detail.h, source.h * scale);
    assert.equal(detail.gridRow, source.row); assert.equal(detail.gridColumn, source.column);
  }
});

test('appending a hero and later model preserves existing detail identity and order', () => {
  const detail = assets.find(asset => asset.group === 'details');
  const initial = buildTurntideLayout([detail], options());
  const added = appendTurntideAssets(initial.elements, [assets.find(asset => asset.group === 'hero'), assets.find(asset => asset.group === 'models')], options());
  assert.equal(added.find(element => element.role === 'details').id, initial.elements.find(element => element.role === 'details').id);
  const hero = added.find(element => element.role === 'cover'), size = added.find(element => element.type === 'size'), image = added.find(element => element.role === 'models');
  assert.ok(hero.y + hero.h <= size.y);
  assert.ok(image.y >= Math.max(...added.filter(element => element.role === 'details').map(element => element.y + element.h)));
});

test('source size defaults never carry example measurements and five actual rows cannot be silently dropped', () => {
  const defaults = turntideSizeDefaults();
  assert.equal(defaults.rows.map(row => row[0]).join(','), 'S,M,L,XL');
  assert.ok(defaults.rows.every(row => row.slice(1).every(value => value === '')));
  const oldBlank = { columns: defaults.columns, rows: ['S', 'M', 'L', 'XL', '2XL', '3XL'].map(size => [size, '', '', '', '']) };
  assert.deepEqual(fitTurntideSizeData(oldBlank), defaults);
  const oldActual = structuredClone(oldBlank); oldActual.rows[4][1] = '90';
  assert.throws(() => fitTurntideSizeData(oldActual), /4 行/);
  assert.equal(oldActual.rows.length, 6); assert.equal(oldActual.rows[4][1], '90');
});

test('recognized source fields are sorted into the four-row original table without invented numeric conversions', () => {
  const defaults = turntideSizeDefaults();
  const source = { columns: ['裤长(cm)', 'SIZE', '脚口(cm)', '臀围(cm)', '腰围(cm)'], rows: [['104', 'M', '57', '118', '78'], ['102', 'S', '55', '114', '74']] };
  const mapped = mapSizeData(defaults.columns, source, defaults.rows.map(row => row[0]));
  assert.deepEqual(mapped.missing, []);
  const fitted = fitTurntideSizeData(mapped.data);
  assert.deepEqual(fitted.rows, [['S', '74', '114', '102', '55'], ['M', '78', '118', '104', '57'], ['L', '', '', '', ''], ['XL', '', '', '', '']]);
});
