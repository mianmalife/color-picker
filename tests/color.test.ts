import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatColor, magnifierPosition, normalizeHex, pixelAt, readableText, rgbToHex, toHsl, validateCaptureSize } from '../src/lib/color.ts'

test('normalizes shorthand, case and invalid input', () => {
  assert.equal(normalizeHex(' #a3f '), '#AA33FF')
  assert.equal(normalizeHex('00aaFF'), '#00AAFF')
  assert.throws(() => normalizeHex('red'))
  assert.throws(() => rgbToHex(256, 0, 0))
})
test('converts primary colors, gray and format output', () => {
  assert.equal(rgbToHex(18, 52, 86), '#123456')
  assert.deepEqual(toHsl('#00FF00'), [120, 100, 50])
  assert.deepEqual(toHsl('#FFFFFF'), [0, 0, 100])
  assert.deepEqual(toHsl('#000000'), [0, 0, 0])
  assert.equal(formatColor('#123456', 'rgb'), 'rgb(18, 52, 86)')
  assert.equal(formatColor('#FF0000', 'hsl'), 'hsl(0, 100%, 50%)')
  assert.equal(readableText('#000000'), '#FFFFFF')
  assert.equal(readableText('#FFFFFF'), '#15201A')
})
test('maps physical pixels for 150% scaling and clamps display edges', () => {
  assert.deepEqual(pixelAt(100, 200, 1280, 720, 1920, 1080), { x: 150, y: 300 })
  assert.deepEqual(pixelAt(1280, 720, 1280, 720, 1920, 1080), { x: 1919, y: 1079 })
  assert.deepEqual(pixelAt(-5, -2, 1280, 720, 1920, 1080), { x: 0, y: 0 })
  assert.deepEqual(pixelAt(0, 0, 1080, 1920, 1080, 1920), { x: 0, y: 0 })
  assert.deepEqual(pixelAt(1706, 959, 1707, 960, 2560, 1440), { x: 2558, y: 1438 })
  assert.throws(() => pixelAt(NaN, 0, 1280, 720, 1920, 1080))
  assert.throws(() => pixelAt(0, 0, 0, 720, 1920, 1080))
})

test('accepts fractional-DPI rounding while rejecting genuinely scaled thumbnails', () => {
  assert.deepEqual(validateCaptureSize({ width: 2560, height: 1440 }, { width: 1707, height: 960 }, 1.5), { width: 2560, height: 1440 })
  assert.deepEqual(validateCaptureSize({ width: 1920, height: 1080 }, { width: 1536, height: 864 }, 1.25), { width: 1920, height: 1080 })
  assert.throws(() => validateCaptureSize({ width: 150, height: 84 }, { width: 1707, height: 960 }, 1.5))
  assert.throws(() => validateCaptureSize({ width: 0, height: 0 }, { width: 1707, height: 960 }, 1.5))
})

test('flips the magnifier away from the target at every screen edge', () => {
  for (const [x, y] of [[0, 0], [1919, 0], [0, 1079], [1919, 1079], [1850, 930], [960, 540]]) {
    const { left, top } = magnifierPosition(x, y, 1920, 1080)
    assert.ok(left >= 12 && top >= 12 && left + 222 <= 1908 && top + 300 <= 1068)
    assert.ok(x < left || x >= left + 222 || y < top || y >= top + 300, `Panel covers pixel ${x},${y}`)
  }
})
