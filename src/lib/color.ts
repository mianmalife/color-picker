import type { ColorFormat } from '../types'

export function normalizeHex(input: string): string {
  const match = /^#?([\da-f]{6}|[\da-f]{3})$/i.exec(input.trim())
  if (!match) throw new Error('请输入有效的 HEX 色值，例如 #A3E635')
  const value = match[1].length === 3 ? [...match[1]].map(c => c + c).join('') : match[1]
  return `#${value.toUpperCase()}`
}

export function rgbToHex(r: number, g: number, b: number): string {
  if (![r, g, b].every(v => Number.isInteger(v) && v >= 0 && v <= 255)) throw new Error('无效的 RGB 值')
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

export function toRgb(hex: string): [number, number, number] {
  const value = normalizeHex(hex)
  return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)]
}

export function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map(c => c / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  const lightness = (max + min) / 2
  let hue = 0
  if (delta) {
    if (max === r) hue = ((g - b) / delta) % 6
    else if (max === g) hue = (b - r) / delta + 2
    else hue = (r - g) / delta + 4
  }
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
  return [Math.round((hue * 60 + 360) % 360) % 360, Math.round(saturation * 100), Math.round(lightness * 100)]
}

export function formatColor(hex: string, format: ColorFormat, template = '{hex}'): string {
  if (format === 'custom') return formatTemplate(hex, template)
  if (format === 'rgb') return `rgb(${toRgb(hex).join(', ')})`
  if (format === 'hsl') { const [h, s, l] = toHsl(hex); return `hsl(${h}, ${s}%, ${l}%)` }
  return normalizeHex(hex)
}

export function formatTemplate(hex: string, template: string): string {
  if (typeof template !== 'string' || !template.trim() || template.length > 512 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(template)) throw new Error('复制模板需为 1～512 个字符，不可包含控制字符。')
  const normalized = normalizeHex(hex)
  const [r, g, b] = toRgb(normalized), [h, s, l] = toHsl(normalized)
  const values: Record<string, string> = {
    hex: normalized, hexLower: normalized.toLowerCase(), hexNoHash: normalized.slice(1), hexLowerNoHash: normalized.slice(1).toLowerCase(),
    r: String(r), g: String(g), b: String(b), h: String(h), s: String(s), l: String(l),
    rgb: `rgb(${r}, ${g}, ${b})`, hsl: `hsl(${h}, ${s}%, ${l}%)`
  }
  let result = '', tokens = 0
  for (let i = 0; i < template.length;) {
    if (template.startsWith('{{', i)) { result += '{'; i += 2; continue }
    if (template.startsWith('}}', i)) { result += '}'; i += 2; continue }
    if (template[i] === '{') {
      const end = template.indexOf('}', i + 1)
      if (end < 0) throw new Error('复制模板缺少右花括号。')
      const token = template.slice(i + 1, end)
      if (!Object.hasOwn(values, token)) throw new Error(`未知占位符：{${token}}`)
      result += values[token]; tokens++; i = end + 1
    } else {
      if (template[i] === '}') throw new Error('单独的花括号请写成 {{ 或 }}。')
      result += template[i++]
    }
  }
  if (!tokens) throw new Error('复制模板至少需要一个颜色占位符，例如 {hex}。')
  return result
}

export function validateCopyTemplate(template: string): string { formatTemplate('#123456', template); return template }

export function readableText(hex: string): string {
  const [r, g, b] = toRgb(hex).map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return r * 0.2126 + g * 0.7152 + b * 0.0722 > 0.179 ? '#15201A' : '#FFFFFF'
}

export function pixelAt(x: number, y: number, viewportWidth: number, viewportHeight: number, imageWidth: number, imageHeight: number) {
  if (![x, y, viewportWidth, viewportHeight, imageWidth, imageHeight].every(Number.isFinite) || viewportWidth <= 0 || viewportHeight <= 0 || !Number.isInteger(imageWidth) || !Number.isInteger(imageHeight) || imageWidth <= 0 || imageHeight <= 0) throw new Error('无效的取色坐标或画面尺寸')
  return {
    x: Math.max(0, Math.min(imageWidth - 1, Math.floor(x * imageWidth / viewportWidth))),
    y: Math.max(0, Math.min(imageHeight - 1, Math.floor(y * imageHeight / viewportHeight)))
  }
}

export function validateCaptureSize(actual: { width: number; height: number }, logical: { width: number; height: number }, scaleFactor: number) {
  // DIP bounds are rounded integers. Fractional scaling can differ from native size by a pixel.
  const tolerance = Math.max(1, Math.ceil(scaleFactor))
  if (![actual.width, actual.height, logical.width, logical.height, scaleFactor].every(v => Number.isFinite(v) && v > 0) || !Number.isInteger(actual.width) || !Number.isInteger(actual.height) || Math.abs(actual.width - logical.width * scaleFactor) > tolerance || Math.abs(actual.height - logical.height * scaleFactor) > tolerance) throw new Error('屏幕截图分辨率不匹配，请检查显示缩放设置后重试。')
  return actual
}

export function magnifierPosition(x: number, y: number, viewportWidth: number, viewportHeight: number) {
  const width = 222, height = 300, gap = 28, margin = 12
  const left = x + gap + width <= viewportWidth - margin ? x + gap : x - gap - width
  const top = y + gap + height <= viewportHeight - margin ? y + gap : y - gap - height
  return { left: Math.max(margin, Math.min(left, viewportWidth - width - margin)), top: Math.max(margin, Math.min(top, viewportHeight - height - margin)) }
}
