<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import Icon from './components/Icon.vue'
import PickerOverlay from './components/PickerOverlay.vue'
import { formatColor, normalizeHex, readableText, toHsl, toRgb } from './lib/color'
import type { AppState, ColorFormat, WindowState } from './types'

const api = window.picker
const isPicker = new URLSearchParams(location.search).get('mode') === 'picker'
const windowState = ref<WindowState>({ maximized: false, fullscreen: false })
const state = ref<AppState>({ history: [], settings: { shortcut: 'Control+Alt+C', format: 'hex', customTemplate: '{hex}' }, shortcutAvailable: false })
const selected = ref('#A3E635')
const view = ref<'palette' | 'settings'>('palette')
const query = ref('')
const inputHex = ref('')
const shortcutDraft = ref('')
const formatDraft = ref<ColorFormat>('hex')
const customTemplateDraft = ref('{hex}')
const templatePreset = ref('')
const templatePresets = [
  { label: '大写 HEX', value: '{hex}' }, { label: '小写 HEX', value: '{hexLower}' },
  { label: 'HEX 不带 #', value: '{hexNoHash}' }, { label: 'RGB 数值', value: '{r}, {g}, {b}' },
  { label: 'CSS 声明', value: 'color: {hexLower};' }, { label: 'CSS 变量', value: '--brand-color: {hex};' }
]
const templatePreview = computed(() => {
  try { return { value: formatColor(selected.value, 'custom', customTemplateDraft.value), error: '' } }
  catch (error) { return { value: '', error: (error as Error).message } }
})
const customOutput = computed(() => formatColor(selected.value, 'custom', state.value.settings.customTemplate))
function applyTemplatePreset() { if (templatePreset.value) customTemplateDraft.value = templatePreset.value; templatePreset.value = '' }
const toast = ref('')
const toastError = ref(false)
const capturing = ref(false)
const copied = ref('')
const clearing = ref(false)
let toastTimer: ReturnType<typeof setTimeout>
let copiedTimer: ReturnType<typeof setTimeout>
const disposers: (() => void)[] = []
const rgb = computed(() => toRgb(selected.value))
const hsl = computed(() => toHsl(selected.value))
const ink = computed(() => readableText(selected.value))
const filtered = computed(() => state.value.history.filter(entry => entry.hex.toLowerCase().includes(query.value.trim().toLowerCase()) || formatColor(entry.hex, 'rgb').includes(query.value.trim())))
const shortcutLabel = computed(() => state.value.settings.shortcut.replace('CommandOrControl', 'Ctrl').replace('Control', 'Ctrl').split('+'))
const formats: ColorFormat[] = ['hex', 'rgb', 'hsl']
function message(value: string, error = false) { toast.value = value; toastError.value = error; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.value = '', error ? 6000 : 2600) }
async function run(action: () => Promise<unknown>) { try { await action() } catch (e) { message(String(e).replace(/^Error: /, ''), true) } }
async function startPick() {
  if (capturing.value) return
  capturing.value = true
  await run(() => api.startPick())
  capturing.value = false
}
async function copy(hex = selected.value, format = state.value.settings.format) {
  await run(async () => {
    await api.copy(hex, format)
    copied.value = `${hex}-${format}`
    clearTimeout(copiedTimer); copiedTimer = setTimeout(() => copied.value = '', 1600)
    message(`已复制 ${formatColor(hex, format, state.value.settings.customTemplate)}`)
  })
}
function openSettings() { shortcutDraft.value = state.value.settings.shortcut; formatDraft.value = state.value.settings.format; customTemplateDraft.value = state.value.settings.customTemplate; view.value = 'settings' }
function applyInput() { try { selected.value = normalizeHex(inputHex.value); inputHex.value = '' } catch (e) { message((e as Error).message, true) } }
function recordShortcut(event: KeyboardEvent) {
  if (event.key === 'Tab') return
  event.preventDefault()
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
  if (!event.ctrlKey && !event.altKey && !event.shiftKey) return
  const key = event.code.startsWith('Key') ? event.code.slice(3) : event.code.startsWith('Digit') ? event.code.slice(5) : event.key.length === 1 ? event.key.toUpperCase() : event.key
  shortcutDraft.value = [...(event.ctrlKey ? ['Control'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), key].join('+')
}
async function saveSettings() {
  await run(async () => { state.value = await api.saveSettings({ shortcut: shortcutDraft.value, format: formatDraft.value, customTemplate: formatDraft.value === 'custom' ? customTemplateDraft.value : state.value.settings.customTemplate }); message('设置已保存') })
}
function acceptState(next: AppState) { const previous = state.value.history[0]?.pickedAt; state.value = next; if (next.history[0] && next.history[0].pickedAt !== previous) selected.value = next.history[0].hex }
function pickedTime(value: string) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }
onMounted(async () => {
  if (isPicker) return
  disposers.push(api.onWindowState(next => windowState.value = next))
  await run(async () => { windowState.value = await api.getWindowState() })
  disposers.push(api.onState(acceptState), api.onError(error => { capturing.value = false; message(error, true) }))
  await run(async () => { acceptState(await api.getState()); if (!state.value.shortcutAvailable) message('全局快捷键已被占用，可以到设置中更换；点击按钮仍可取色。', true) })
})
onUnmounted(() => { disposers.forEach(dispose => dispose()); clearTimeout(toastTimer); clearTimeout(copiedTimer) })
</script>

<template>
  <PickerOverlay v-if="isPicker" />
  <div v-else class="app-shell">
    <header class="titlebar" @dblclick.self="run(() => api.windowAction('toggle-maximize'))">
      <div class="brand"><span class="brand-icon"><Icon name="dropper" :size="17" /></span><strong>拾色</strong><span class="brand-en">COLOR PICKER</span></div>
      <div class="window-actions">
        <button data-testid="fullscreen-button" :aria-label="windowState.fullscreen ? '退出全屏' : '全屏'" :title="windowState.fullscreen ? '退出全屏（Esc / F11）' : '全屏（F11）'" :aria-pressed="windowState.fullscreen" @click="run(() => api.windowAction('toggle-fullscreen'))"><Icon :name="windowState.fullscreen ? 'shrink' : 'fullscreen'" :size="16" /></button>
        <button aria-label="最小化" @click="run(() => api.windowAction('minimize'))"><Icon name="minus" :size="16" /></button>
        <button data-testid="maximize-button" :aria-label="windowState.maximized ? '还原窗口' : '最大化'" :title="windowState.fullscreen ? '全屏时不可最大化，请先退出全屏（Esc / F11）' : windowState.maximized ? '还原窗口' : '最大化'" :disabled="windowState.fullscreen" @click="run(() => api.windowAction('toggle-maximize'))"><Icon :name="windowState.maximized ? 'restore' : 'maximize'" :size="16" /></button>
        <button class="window-close" aria-label="关闭到托盘" title="关闭到系统托盘" @click="run(() => api.windowAction('close'))"><Icon name="close" :size="16" /></button>
      </div>
    </header>
    <div class="workspace">
      <aside class="sidebar">
        <div class="nav-label">工作空间</div>
        <button class="nav-item" :class="{ active: view === 'palette' }" @click="view = 'palette'"><Icon name="grid" />拾色板<span class="nav-count">{{ state.history.length }}</span></button>
        <button class="nav-item" :class="{ active: view === 'settings' }" @click="openSettings"><Icon name="settings" />偏好设置</button>
        <div class="sidebar-note"><div class="note-art"><Icon name="dropper" :size="28" /><span class="note-dot dot-one" /><span class="note-dot dot-two" /></div><strong>灵感，始于一抹颜色。</strong><p>捕捉屏幕上的每一个好颜色，<br />留住下一次创作的灵感。</p></div>
        <div class="local-status"><span class="live-dot" />本地存储<span>v0.2.0</span></div>
      </aside>
      <main class="main-content">
        <template v-if="view === 'palette'">
          <div class="page-heading"><div><div class="eyebrow">YOUR EVERYDAY COLOR COMPANION</div><h1>发现你的下一抹色彩<span>。</span></h1><p>读取屏幕像素，预览、收藏与复制保持一致。</p></div><span class="platform-badge"><Icon name="monitor" :size="14" />WINDOWS</span></div>
          <section class="hero-panel">
            <div class="hero-intro"><div class="section-kicker"><span class="live-dot" />屏幕取色</div><h2>好颜色，就在眼前。</h2><p>网页、图片、桌面上的任意位置，<br />轻轻一点，即刻拥有。</p><button class="pick-button" data-testid="pick-button" :disabled="capturing" @click="startPick"><Icon name="dropper" />{{ capturing ? '正在准备…' : '开始取色' }}<Icon name="arrow" :size="18" /></button><div class="shortcut-hint">或按下 <kbd v-for="key in shortcutLabel" :key="key">{{ key }}</kbd></div></div>
            <div class="hero-swatch" :style="{ background: selected, color: ink }"><div class="swatch-top"><span>CURRENT COLOR</span><span class="swatch-circle" /></div><div class="swatch-bottom"><strong data-testid="selected-hex">{{ selected }}</strong><span>RGB {{ rgb.join(' · ') }}</span></div><span class="swatch-decoration" /></div>
          </section>
          <section class="values-row" aria-label="颜色数值"><button v-for="format in formats" :key="format" class="value-card" @click="copy(selected, format)"><span>{{ format.toUpperCase() }}</span><strong>{{ formatColor(selected, format) }}</strong><Icon :name="copied === `${selected}-${format}` ? 'check' : 'copy'" :size="17" /></button></section>
          <button v-if="state.settings.format === 'custom'" class="custom-copy" data-testid="custom-copy" @click="copy(selected, 'custom')"><span>自定义复制</span><code>{{ customOutput }}</code><Icon name="copy" :size="17" /></button>
          <section class="history-section"><div class="section-heading"><h2><Icon name="history" :size="19" />最近拾取<span>{{ state.history.length }}</span></h2><div class="history-tools"><label class="search-box"><Icon name="search" :size="15" /><input v-model="query" placeholder="搜索色值" aria-label="搜索颜色" /></label><button v-if="state.history.length" class="icon-button" title="清空历史" aria-label="清空历史" @click="clearing = !clearing"><Icon name="trash" :size="17" /></button></div></div>
            <div v-if="clearing" class="clear-confirm">清空全部 {{ state.history.length }} 个历史颜色？<button @click="run(async () => { state = await api.clearHistory(); clearing = false })">清空</button><button @click="clearing = false">取消</button></div>
            <div v-if="filtered.length" class="history-grid"><article v-for="entry in filtered" :key="entry.hex" class="history-card" :class="{ selected: selected === entry.hex }"><button class="history-swatch" :style="{ background: entry.hex }" :aria-label="`选择 ${entry.hex}`" @click="selected = entry.hex"><span v-if="selected === entry.hex" :style="{ color: readableText(entry.hex) }"><Icon name="check" :size="19" /></span></button><div class="history-info"><button class="history-code" @click="selected = entry.hex">{{ entry.hex }}</button><button class="history-copy" :aria-label="`复制 ${entry.hex}`" @click="copy(entry.hex)"><Icon :name="copied.startsWith(entry.hex) ? 'check' : 'copy'" :size="14" /></button></div><div class="history-meta"><span>{{ pickedTime(entry.pickedAt) }}</span><button :aria-label="`删除 ${entry.hex}`" @click="run(async () => { state = await api.removeColor(entry.hex) })">移除</button></div></article></div>
            <div v-else class="empty-state"><div class="empty-icon"><Icon :name="query ? 'search' : 'dropper'" :size="25" /></div><strong>{{ query ? '没有找到匹配的颜色' : '你的色彩收藏，从这里开始' }}</strong><p>{{ query ? '试试 HEX 或 RGB 中的数字。' : '点击「开始取色」，第一抹灵感就会出现在这里。' }}</p></div>
          </section>
          <footer class="workspace-footer"><span><Icon name="keyboard" :size="15" />取色时滚轮缩放，方向键微调，Enter 确认</span><form @submit.prevent="applyInput"><input v-model="inputHex" placeholder="输入 HEX 预览" aria-label="输入 HEX 预览" maxlength="7" /><button type="submit" title="预览颜色" aria-label="预览颜色"><Icon name="arrow" :size="15" /></button></form></footer>
        </template>
        <template v-else>
          <div class="page-heading"><div><div class="eyebrow">MAKE IT YOURS</div><h1>让拾色，顺手一点<span>。</span></h1><p>设置你的快捷键与常用颜色格式。</p></div></div>
          <section class="settings-panel"><div class="setting-row"><div><h2>全局取色快捷键</h2><p>在其他应用中也能随时唤起。点击右侧输入框按下组合键。</p></div><input class="shortcut-input" :value="shortcutDraft.replace('Control', 'Ctrl')" aria-label="全局快捷键" @keydown="recordShortcut" /></div><div class="setting-row"><div><h2>默认复制格式</h2><p>取色确认后，自动将颜色复制为此格式。</p></div><select v-model="formatDraft" aria-label="默认复制格式"><option value="hex">HEX · #A3E635</option><option value="rgb">RGB · rgb(163, 230, 53)</option><option value="hsl">HSL · hsl(83, 78%, 55%)</option><option value="custom">自定义复制模板</option></select></div><div v-if="formatDraft === 'custom'" class="template-editor">
            <div class="template-heading"><label for="copy-template">自定义复制模板</label><select v-model="templatePreset" aria-label="复制模板预设" @change="applyTemplatePreset"><option value="">选择预设…</option><option v-for="preset in templatePresets" :key="preset.label" :value="preset.value">{{ preset.label }}</option></select></div>
            <textarea id="copy-template" v-model="customTemplateDraft" aria-label="自定义复制模板" maxlength="512" rows="3" spellcheck="false" />
            <p class="template-help" v-pre>支持 {hex}、{hexLower}、{hexNoHash}、{hexLowerNoHash}、{r} {g} {b}、{h} {s} {l}、{rgb}、{hsl}。字面花括号写成 {{ 和 }}。</p>
            <div class="template-preview"><span>当前颜色的复制预览</span><output data-testid="template-preview">{{ templatePreview.value }}</output></div>
            <p v-if="templatePreview.error" class="template-error" role="alert">{{ templatePreview.error }}</p>
          </div><div class="setting-row"><div><h2>关闭窗口后继续运行</h2><p>关闭按钮会收起到系统托盘，右键托盘图标可以退出。</p></div><span class="enabled-label"><span class="live-dot" />已开启</span></div><div class="settings-actions"><button class="pick-button" :disabled="formatDraft === 'custom' && !!templatePreview.error" @click="saveSettings"><Icon name="check" :size="18" />保存设置</button></div></section>
          <div class="privacy-note"><Icon name="monitor" :size="22" /><div><strong>你的颜色，只属于你。</strong><p>颜色与设置保存在此电脑。取色读取桌面截图像素；网页或图片的原始色值可能不同。截图只在取色期间驻留内存。</p></div></div>
        </template>
      </main>
    </div>
    <Transition name="toast"><div v-if="toast" role="status" class="toast-message" :class="{ error: toastError }"><Icon :name="toastError ? 'close' : 'check'" :size="17" />{{ toast }}</div></Transition>
  </div>
</template>

