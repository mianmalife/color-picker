<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { magnifierPosition, pixelAt, toRgb } from '../lib/color'
import { desktopPixel } from '../lib/capture'
import { DEFAULT_ZOOM_LEVEL, MAGNIFIER_GRIDS, nudgePixel, wheelZoom } from '../lib/picker-controls'
import type { Capture } from '../types'

const canvas = ref<HTMLCanvasElement>()
const zoomCanvas = ref<HTMLCanvasElement>()
const capture = ref<Capture>()
const color = ref('#000000')
const point = ref({ x: 0, y: 0 })
const mouse = ref({ x: 0, y: 0 })
const visible = ref(false)
const pointerInside = ref(false)
const error = ref('')
const zoomLevel = ref(DEFAULT_ZOOM_LEVEL)
const keyboardMode = ref(false)
const gridSize = computed(() => MAGNIFIER_GRIDS[zoomLevel.value])
const zoomFactor = computed(() => 198 / gridSize.value)
let lastPointer = { x: 0, y: 0 }
let busy = false
let frame = 0
let sourceContext: CanvasRenderingContext2D | null = null
const panelPosition = computed(() => {
  const { left, top } = magnifierPosition(mouse.value.x, mouse.value.y, innerWidth, innerHeight)
  return { left: `${left}px`, top: `${top}px` }
})
const rgb = computed(() => toRgb(color.value).join(', '))
function sample() {
  const source = canvas.value, zoom = zoomCanvas.value, image = capture.value
  if (!source || !zoom || !image || !visible.value) return
  const ctx = sourceContext
  if (!ctx) return
  const { x, y } = point.value
  color.value = desktopPixel(image.pixels, image.width, image.height, x, y)
  const z = zoom.getContext('2d')!
  z.imageSmoothingEnabled = false
  z.fillStyle = '#202723'; z.fillRect(0, 0, 198, 198)
  // drawImage clips source edges while preserving the selected pixel in the center.
  const grid = gridSize.value, half = Math.floor(grid / 2), cell = 198 / grid
  z.drawImage(source, x - half, y - half, grid, grid, 0, 0, 198, 198)
  z.strokeStyle = 'rgba(0,0,0,.18)'; z.lineWidth = 1
  for (let i = 0; i <= grid; i++) { z.beginPath(); z.moveTo(i * cell, 0); z.lineTo(i * cell, 198); z.stroke(); z.beginPath(); z.moveTo(0, i * cell); z.lineTo(198, i * cell); z.stroke() }
  z.strokeStyle = '#000'; z.lineWidth = 3; z.strokeRect(half * cell, half * cell, cell, cell)
  z.strokeStyle = '#fff'; z.lineWidth = 1; z.strokeRect(half * cell, half * cell, cell, cell)
}
function setMousePoint(x: number, y: number) {
  const image = capture.value
  if (!image) return
  keyboardMode.value = false; lastPointer = { x, y }; mouse.value = { x, y }
  point.value = pixelAt(x, y, innerWidth, innerHeight, image.width, image.height)
}
function move(event: MouseEvent) {
  pointerInside.value = true
  if (keyboardMode.value && event.clientX === lastPointer.x && event.clientY === lastPointer.y) return
  setMousePoint(event.clientX, event.clientY)
  cancelAnimationFrame(frame); frame = requestAnimationFrame(sample)
}
async function commit() {
  if (!visible.value || busy) return
  cancelAnimationFrame(frame); sample(); busy = true
  try { await window.picker.selectPixel(point.value.x, point.value.y) }
  catch (e) { error.value = String(e); busy = false }
}
async function select(event: MouseEvent) {
  if (!visible.value || busy || event.button !== 0) return
  if (!keyboardMode.value || event.clientX !== lastPointer.x || event.clientY !== lastPointer.y) setMousePoint(event.clientX, event.clientY)
  await commit()
}
function wheel(event: WheelEvent) {
  if (!visible.value || busy) return
  zoomLevel.value = wheelZoom(zoomLevel.value, event.deltaY)
  cancelAnimationFrame(frame); sample()
}
async function cancel() { try { await window.picker.cancelPick() } catch { /* Session already closed. */ } }
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); void cancel(); return }
  if (!visible.value || busy || !pointerInside.value || event.ctrlKey || event.altKey || event.metaKey) return
  if (event.key === 'Enter') { event.preventDefault(); void commit(); return }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  const image = capture.value!
  point.value = nudgePixel(point.value, event.key, image.width, image.height, event.shiftKey)
  keyboardMode.value = true
  mouse.value = { x: (point.value.x + 0.5) * innerWidth / image.width, y: (point.value.y + 0.5) * innerHeight / image.height }
  cancelAnimationFrame(frame); sample()
}
onMounted(async () => {
  window.addEventListener('keydown', key)
  window.addEventListener('contextmenu', contextMenu)
  try {
    capture.value = await window.picker.getCapture()
    const source = canvas.value!
    source.width = capture.value.width; source.height = capture.value.height
    if (capture.value.colorSpace !== 'srgb' || capture.value.pixelFormat !== 'rgba8') throw new Error('不支持的屏幕像素格式，请重新取色。')
    desktopPixel(capture.value.pixels, capture.value.width, capture.value.height, 0, 0)
    sourceContext = source.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' })
    if (!sourceContext) throw new Error('无法创建取色画面，请重试。')
    sourceContext.putImageData(new ImageData(new Uint8ClampedArray(capture.value.pixels), capture.value.width, capture.value.height, { colorSpace: 'srgb' }), 0, 0)
    pointerInside.value = capture.value.cursor.x >= 0 && capture.value.cursor.x < innerWidth && capture.value.cursor.y >= 0 && capture.value.cursor.y < innerHeight
    mouse.value = { x: Math.max(0, Math.min(innerWidth - 1, capture.value.cursor.x)), y: Math.max(0, Math.min(innerHeight - 1, capture.value.cursor.y)) }
    lastPointer = { ...mouse.value }
    point.value = pixelAt(mouse.value.x, mouse.value.y, innerWidth, innerHeight, capture.value.width, capture.value.height)
    visible.value = true
    await nextTick(); sample()
    await window.picker.overlayReady()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    await window.picker.failPick(error.value).catch(() => {})
  }
})
function contextMenu(event: MouseEvent) { event.preventDefault(); void cancel() }
onUnmounted(() => { window.removeEventListener('keydown', key); window.removeEventListener('contextmenu', contextMenu); cancelAnimationFrame(frame) })
</script>
<template>
  <div class="picker-overlay" :class="{ 'keyboard-mode': keyboardMode }" data-testid="picker-overlay" @mousemove="move" @mouseleave="pointerInside = false" @mousedown="select" @wheel.prevent="wheel">
    <canvas ref="canvas" class="screen-canvas" />
    <div v-if="visible && pointerInside && keyboardMode" class="pixel-crosshair" :style="{ left: `${mouse.x}px`, top: `${mouse.y}px` }" />
    <div v-if="visible" v-show="pointerInside" class="magnifier" :style="panelPosition" :data-x="point.x" :data-y="point.y" :data-grid="gridSize">
      <canvas ref="zoomCanvas" width="198" height="198" />
      <div class="magnifier-color"><i :style="{ background: color }" /><strong data-testid="preview-hex">{{ color }}</strong></div>
      <div class="magnifier-rgb">RGB {{ rgb }} · sRGB</div>
      <div class="magnifier-meta"><span data-testid="zoom-factor">{{ zoomFactor }}×</span><span data-testid="pixel-coordinate">X {{ point.x }} · Y {{ point.y }}</span></div>
    </div>
    <div class="picker-guide"><span class="live-dot" />{{ error || (keyboardMode ? '微调中，移动鼠标恢复' : '移动鼠标选择颜色') }}<span class="guide-divider" /><span>滚轮缩放 · 方向键微调 · Shift 加速</span><span>左键 / Enter 确认 · Esc 取消</span></div>
  </div>
</template>
