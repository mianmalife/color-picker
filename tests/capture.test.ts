import { test } from 'node:test'
import assert from 'node:assert/strict'
import { desktopPixel, desktopRgba } from '../src/lib/capture.ts'

test('desktop buffer preserves channel values, rows and boundary pixels without compensation', () => {
  const bgra = new Uint8Array([228, 139, 4, 255, 224, 139, 55, 255, 0, 0, 255, 255, 255, 0, 0, 255])
  const pixels = desktopRgba(bgra, 2, 2)
  assert.equal(desktopPixel(pixels, 2, 2, 0, 0), '#048BE4')
  assert.equal(desktopPixel(pixels, 2, 2, 1, 0), '#378BE0')
  assert.equal(desktopPixel(pixels, 2, 2, 0, 1), '#FF0000')
  assert.equal(desktopPixel(pixels, 2, 2, 1, 1), '#0000FF')
  bgra.fill(0)
  assert.equal(desktopPixel(pixels, 2, 2, 0, 0), '#048BE4')
})

test('rejects incomplete, transparent or invalid captures and out-of-range points', () => {
  assert.throws(() => desktopRgba(new Uint8Array(3), 1, 1))
  assert.throws(() => desktopRgba(new Uint8Array([0, 0, 0, 128]), 1, 1))
  assert.throws(() => desktopRgba(new Uint8Array(), 0, 1))
  const pixels = new Uint8Array([4, 139, 228, 255])
  for (const [x, y] of [[-1, 0], [1, 0], [0, 1], [0.5, 0], [NaN, 0]]) assert.throws(() => desktopPixel(pixels, 1, 1, x, y))
  assert.throws(() => desktopPixel(pixels, 2, 1, 0, 0))
})
