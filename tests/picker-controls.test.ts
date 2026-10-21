import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAGNIFIER_GRIDS, nudgePixel, wheelZoom } from '../src/lib/picker-controls.ts'
import { pixelAt, formatColor, formatTemplate, validateCopyTemplate } from '../src/lib/color.ts'

test('wheel zoom stays on odd grids with a unique center pixel and clamps both limits', () => {
  for (const grid of MAGNIFIER_GRIDS) { assert.equal(grid % 2, 1); assert.equal(198 % grid, 0) }
  assert.equal(wheelZoom(1, -100), 2)
  assert.equal(wheelZoom(2, -100), 2)
  assert.equal(wheelZoom(1, 100), 0)
  assert.equal(wheelZoom(0, 100), 0)
  assert.equal(wheelZoom(1, 0), 1)
  assert.equal(wheelZoom(1, NaN), 1)
})

test('keyboard nudges exact physical pixels at fractional DPI and clamps all edges', () => {
  const start = pixelAt(100, 100, 1280, 720, 1920, 1080)
  assert.deepEqual(nudgePixel(start, 'ArrowRight', 1920, 1080), { x: 151, y: 150 })
  assert.deepEqual(nudgePixel(start, 'ArrowUp', 1920, 1080, true), { x: 150, y: 140 })
  assert.deepEqual(nudgePixel({ x: 0, y: 0 }, 'ArrowLeft', 1920, 1080), { x: 0, y: 0 })
  assert.deepEqual(nudgePixel({ x: 1919, y: 1079 }, 'ArrowDown', 1920, 1080, true), { x: 1919, y: 1079 })
  assert.deepEqual(nudgePixel({ x: 1919, y: 1079 }, 'ArrowRight', 1920, 1080), { x: 1919, y: 1079 })
  assert.throws(() => nudgePixel({ x: -1, y: 0 }, 'ArrowRight', 1920, 1080))
})

test('copy templates support case, prefix, RGB/HSL, multiline and literal CSS braces', () => {
  assert.equal(formatTemplate('#048BE4', '{hex}|{hexLower}|{hexNoHash}|{hexLowerNoHash}'), '#048BE4|#048be4|048BE4|048be4')
  assert.equal(formatTemplate('#048BE4', '{r}, {g}, {b}'), '4, 139, 228')
  assert.equal(formatTemplate('#00FF00', '{h} {s}% {l}% / {hsl}'), '120 100% 50% / hsl(120, 100%, 50%)')
  assert.equal(formatColor('#123456', 'custom', '.swatch {{\n  color: {hexLower};\n}}'), '.swatch {\n  color: #123456;\n}')
  assert.equal(formatTemplate('#048BE4', '{rgb}'), 'rgb(4, 139, 228)')
})

test('copy template validation rejects typos and oversized/control inputs without evaluation', () => {
  for (const value of ['', 'fixed text', '{unknown}', '{hex', '{hex}}', '{hex}\u0000', 'x'.repeat(513), '{__proto__}', '{constructor}', '{hexLowerCase}']) assert.throws(() => validateCopyTemplate(value))
  assert.equal(formatTemplate('#123456', '$(echo untouched) {hex}'), '$(echo untouched) #123456')
})
