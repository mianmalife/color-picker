export const MAGNIFIER_GRIDS = [33, 11, 3] as const
export const DEFAULT_ZOOM_LEVEL = 1

export function wheelZoom(level: number, deltaY: number): number {
  if (!Number.isInteger(level) || level < 0 || level >= MAGNIFIER_GRIDS.length) throw new Error('无效的放大倍率')
  return !Number.isFinite(deltaY) || deltaY === 0 ? level : Math.max(0, Math.min(MAGNIFIER_GRIDS.length - 1, level - Math.sign(deltaY)))
}

export function nudgePixel(point: { x: number; y: number }, key: string, width: number, height: number, fast = false) {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0) || !Number.isInteger(point.x) || !Number.isInteger(point.y) || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) throw new Error('无效的取样坐标或截图尺寸')
  const step = fast ? 10 : 1
  const offset: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
  const [dx, dy] = offset[key] ?? [0, 0]
  return { x: Math.max(0, Math.min(width - 1, point.x + dx)), y: Math.max(0, Math.min(height - 1, point.y + dy)) }
}
