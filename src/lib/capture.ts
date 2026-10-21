import { rgbToHex } from './color.ts'

/** Desktop captures are opaque. Normalize once, then share these exact bytes. */
export function desktopRgba(bitmap: Uint8Array, width: number, height: number): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || bitmap.length !== width * height * 4) throw new Error('屏幕像素数据尺寸不一致，请重新取色。')
  const rgba = new Uint8Array(bitmap.length)
  for (let i = 0; i < bitmap.length; i += 4) {
    if (bitmap[i + 3] !== 255) throw new Error('屏幕截图包含透明像素，无法可靠取色，请重试。')
    rgba[i] = bitmap[i + 2]; rgba[i + 1] = bitmap[i + 1]; rgba[i + 2] = bitmap[i]; rgba[i + 3] = 255
  }
  return rgba
}

export function desktopPixel(pixels: Uint8Array, width: number, height: number, x: number, y: number): string {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || pixels.length !== width * height * 4 || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) throw new Error('无效的像素坐标或屏幕数据')
  const offset = (y * width + x) * 4
  return rgbToHex(pixels[offset], pixels[offset + 1], pixels[offset + 2])
}
