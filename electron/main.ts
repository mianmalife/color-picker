import { app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, session, Tray } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { formatColor, normalizeHex, validateCaptureSize, validateCopyTemplate } from '../src/lib/color'
import { desktopPixel, desktopRgba } from '../src/lib/capture'
import type { AppState, Capture, ColorFormat, Settings, WindowAction, WindowState } from '../src/types'

const smokeDir = process.argv.find(arg => arg.startsWith('--smoke-data='))?.slice('--smoke-data='.length)
if (smokeDir && !app.isPackaged) app.setPath('userData', smokeDir)
const defaults: Settings = { shortcut: 'Control+Alt+C', format: 'hex', customTemplate: '{hex}' }
const formats: ColorFormat[] = ['hex', 'rgb', 'hsl', 'custom']
let state: AppState = { history: [], settings: { ...defaults }, shortcutAvailable: false }
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let screenLocked = false
let fullscreenTarget = false
let fullscreenTransition: Promise<void> = Promise.resolve()
type Overlay = { win: BrowserWindow; displayId: number; capture: Capture; ready: boolean }
type PickSession = { id: string; overlays: Overlay[]; restore: boolean; restoreFullscreen: boolean; wasMinimized: boolean; active: boolean; timer?: NodeJS.Timeout }
let picking: PickSession | null = null

function settingsFile() { return join(app.getPath('userData'), 'colors.json') }
function loadState() {
  try {
    const stored = JSON.parse(readFileSync(settingsFile(), 'utf8'))
    if (stored.version !== 1) return
    if (Array.isArray(stored.history)) {
      const seen = new Set<string>()
      state.history = stored.history.flatMap((entry: { hex: string; pickedAt: string }) => {
        try {
          const hex = normalizeHex(entry.hex)
          if (seen.has(hex) || !Number.isFinite(Date.parse(entry.pickedAt))) return []
          seen.add(hex)
          return [{ hex, pickedAt: entry.pickedAt }]
        } catch { return [] }
      }).slice(0, 80)
    }
    if (formats.includes(stored.settings?.format)) state.settings.format = stored.settings.format
    if (stored.settings?.customTemplate !== undefined) {
      try { state.settings.customTemplate = validateCopyTemplate(stored.settings.customTemplate) }
      catch { if (state.settings.format === 'custom') state.settings.format = 'hex' }
    }
    if (typeof stored.settings?.shortcut === 'string' && stored.settings.shortcut.length <= 80) state.settings.shortcut = stored.settings.shortcut
  } catch { /* First launch or an unreadable settings file uses defaults. */ }
}
function persist(next: AppState) {
  mkdirSync(app.getPath('userData'), { recursive: true })
  const temp = `${settingsFile()}.tmp`
  writeFileSync(temp, JSON.stringify({ version: 1, history: next.history, settings: next.settings }, null, 2), 'utf8')
  renameSync(temp, settingsFile())
  state = next
  mainWindow?.webContents.send('state:changed', state)
}
function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}
function getWindowState(): WindowState {
  return { maximized: mainWindow?.isMaximized() ?? false, fullscreen: mainWindow?.isFullScreen() ?? false }
}
function windowAction(action: WindowAction) {
  const win = mainWindow
  if (!win || win.isDestroyed() || picking) return
  if (action === 'minimize') win.minimize()
  else if (action === 'close') win.close()
  else if (action === 'toggle-fullscreen') return changeFullscreen(!fullscreenTarget)
  else if (action === 'exit-fullscreen') return changeFullscreen(false)
  else if (action === 'toggle-maximize') {
    if (!win.isFullScreen()) { if (win.isMaximized()) win.unmaximize(); else win.maximize() }
  } else throw new Error('无效的窗口操作')
}
function changeFullscreen(enabled: boolean): Promise<void> {
  fullscreenTarget = enabled
  const transition = fullscreenTransition.catch(() => {}).then(() => {
    const win = mainWindow
    if (!win || win.isDestroyed() || quitting || win.isFullScreen() === enabled) return
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => { win.removeListener('enter-full-screen', done); win.removeListener('leave-full-screen', done) }
      const done = () => { clearTimeout(timer); cleanup(); resolve() }
      const timer = setTimeout(() => { cleanup(); reject(new Error('窗口全屏切换超时，请重试。')) }, 3000)
      if (enabled) win.once('enter-full-screen', done)
      else win.once('leave-full-screen', done)
      win.setFullScreen(enabled)
    })
  })
  fullscreenTransition = transition
  return transition
}
function notifyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  showMain()
  mainWindow?.webContents.send('app:error', message)
}
function lockWindow(win: BrowserWindow) {
  win.setMenu(null)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.on('will-attach-webview', event => event.preventDefault())
  win.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && ['+', '-', '=', '0', 'r'].includes(input.key.toLowerCase())) event.preventDefault()
  })
}
function loadPage(win: BrowserWindow, query: Record<string, string> = {}) {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value))
    return win.loadURL(url.toString())
  }
  return win.loadFile(join(__dirname, '../renderer/index.html'), { query })
}
function webPreferences() {
  return { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
}
async function createMain() {
  mainWindow = new BrowserWindow({
    width: 1060, height: 780, minWidth: 860, minHeight: 650, show: false,
    frame: false, backgroundColor: '#101613', title: 'Color Picker · 拾色',
    icon: join(app.getAppPath(), 'resources/icon.ico'), webPreferences: webPreferences()
  })
  lockWindow(mainWindow)
  const publishWindowState = () => mainWindow?.webContents.send('window:changed', getWindowState())
  mainWindow.on('maximize', publishWindowState)
  mainWindow.on('unmaximize', publishWindowState)
  mainWindow.on('enter-full-screen', publishWindowState)
  mainWindow.on('leave-full-screen', publishWindowState)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat || input.control || input.alt || input.meta) return
    if (input.key === 'F11') { event.preventDefault(); void Promise.resolve(windowAction('toggle-fullscreen')).catch(notifyError) }
    else if (input.key === 'Escape' && fullscreenTarget) { event.preventDefault(); void Promise.resolve(windowAction('exit-fullscreen')).catch(notifyError) }
  })
  mainWindow.on('close', event => {
    if (!quitting && tray) { event.preventDefault(); mainWindow?.hide() }
  })
  mainWindow.webContents.on('render-process-gone', () => {
    if (!quitting) void mainWindow?.reload()
  })
  await loadPage(mainWindow)
  showMain()
}
function finishPick(show = false) {
  const current = picking
  picking = null
  if (!current) return
  clearTimeout(current.timer)
  current.overlays.forEach(({ win }) => { if (!win.isDestroyed()) win.destroy() })
  if (quitting) return
  if (show || current.restore) {
    showMain()
    if (current.restoreFullscreen) void changeFullscreen(true).catch(notifyError)
  } else if (current.wasMinimized) { mainWindow?.showInactive(); mainWindow?.minimize() }
}
async function startPick() {
  if (picking) return
  if (screenLocked || powerMonitor.getSystemIdleState(1) === 'locked') throw new Error('屏幕已锁定，请解锁后重新取色。')
  const current: PickSession = {
    id: randomUUID(), overlays: [], active: false,
    restore: Boolean(mainWindow?.isVisible() && !mainWindow.isMinimized()),
    restoreFullscreen: fullscreenTarget, wasMinimized: Boolean(mainWindow?.isMinimized())
  }
  picking = current
  current.timer = setTimeout(() => { if (picking === current) { finishPick(true); notifyError(new Error('取色准备超时，请重试。')) } }, 20000)
  try {
    // Wait for the native fullscreen transition before hiding; otherwise the app can appear in its own screenshot.
    await changeFullscreen(false)
    if (picking !== current) return
    mainWindow?.hide()
    // Wait for the application's own window to disappear before capturing the desktop.
    await new Promise(resolve => setTimeout(resolve, 200))
    if (picking !== current) return
    const displays = screen.getAllDisplays()
    const cursor = screen.getCursorScreenPoint()
    const captures = await Promise.all(displays.map(async display => {
      const width = Math.round(display.size.width * display.scaleFactor)
      const height = Math.round(display.size.height * display.scaleFactor)
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } })
      const source = sources.find(item => item.display_id === String(display.id))
      if (!source || source.thumbnail.isEmpty()) throw new Error('无法读取屏幕，请检查显示器状态后重试。')
      const size = validateCaptureSize(source.thumbnail.getSize(1), display.size, display.scaleFactor)
      // Use explicit sRGB output once. Never infer the source application's CSS or
      // apply a monitor-specific compensation to already captured desktop pixels.
      const bitmap = source.thumbnail.toBitmap({ scaleFactor: 1, colorSpace: { primaries: 'bt709', transfer: 'srgb', matrix: 'rgb', range: 'full' } })
      const pixels = desktopRgba(bitmap, size.width, size.height)
      return { display, capture: {
        pixels, colorSpace: 'srgb' as const, pixelFormat: 'rgba8' as const, width: size.width, height: size.height, sessionId: current.id,
        cursor: { x: cursor.x - display.bounds.x, y: cursor.y - display.bounds.y }
      } }
    }))
    if (picking !== current) return
    for (const { display, capture } of captures) {
      const win = new BrowserWindow({ ...display.bounds, frame: false, show: false, resizable: false,
        movable: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false,
        backgroundColor: '#101613', webPreferences: webPreferences() })
      lockWindow(win)
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setBounds(display.bounds)
      current.overlays.push({ win, capture, displayId: display.id, ready: false })
      win.on('closed', () => { if (picking === current) finishPick() })
      win.webContents.on('render-process-gone', () => {
        if (picking === current) { finishPick(true); notifyError(new Error('取色窗口异常关闭，请重试。')) }
      })
    }
    await Promise.all(current.overlays.map(({ win }) => loadPage(win, { mode: 'picker' })))
  } catch (error) {
    if (picking !== current) return
    finishPick(true)
    throw error
  }
}
function launchPick() { void startPick().catch(notifyError) }
function overlayFor(event: IpcMainInvokeEvent) {
  const overlay = picking?.overlays.find(item => item.win.webContents === event.sender)
  if (!overlay) throw new Error('取色会话已结束')
  return overlay
}
function assertSender(event: IpcMainInvokeEvent, role: 'main' | 'overlay') {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error('无效的调用来源')
  if (role === 'main' && mainWindow?.webContents !== event.sender) throw new Error('无效的主窗口')
  if (role === 'overlay') overlayFor(event)
}
function handle(channel: string, role: 'main' | 'overlay', callback: (event: IpcMainInvokeEvent, payload: any) => unknown) {
  ipcMain.handle(channel, (event, payload) => { assertSender(event, role); return callback(event, payload) })
}
function registerIpc() {
  handle('state:get', 'main', () => state)
  handle('pick:start', 'main', async () => {
    try { await startPick() }
    catch (error) { notifyError(error); throw error }
  })
  handle('pick:capture', 'overlay', event => overlayFor(event).capture)
  handle('pick:ready', 'overlay', event => {
    overlayFor(event).ready = true
    const current = picking!
    if (!current.active && current.overlays.every(item => item.ready)) {
      current.active = true
      clearTimeout(current.timer)
      current.overlays.forEach(({ win }) => win.showInactive())
      const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      ;(current.overlays.find(item => item.displayId === cursorDisplay.id) ?? current.overlays[0]).win.focus()
    }
  })
  handle('pick:cancel', 'overlay', () => finishPick())
  handle('pick:fail', 'overlay', (_, message) => {
    finishPick(true)
    notifyError(new Error(typeof message === 'string' ? message.slice(0, 240) : '取色画面加载失败，请重试。'))
  })
  handle('pick:select', 'overlay', (event, point) => {
    const overlay = overlayFor(event)
    if (!picking?.active) throw new Error('取色画面尚未准备完成')
    if (!point || !Number.isInteger(point.x) || !Number.isInteger(point.y) || point.x < 0 || point.y < 0 || point.x >= overlay.capture.width || point.y >= overlay.capture.height) throw new Error('无效的像素坐标')
    try {
      const { pixels, width, height } = overlay.capture
      const hex = desktopPixel(pixels, width, height, point.x, point.y)
      persist({ ...state, history: [{ hex, pickedAt: new Date().toISOString() }, ...state.history.filter(entry => entry.hex !== hex)].slice(0, 80) })
      clipboard.writeText(formatColor(hex, state.settings.format, state.settings.customTemplate))
      finishPick(true)
    } catch (error) { finishPick(true); notifyError(error); throw error }
  })
  handle('color:copy', 'main', (_, value) => {
    if (!value || !formats.includes(value.format)) throw new Error('无效的颜色格式')
    clipboard.writeText(formatColor(normalizeHex(value.hex), value.format, state.settings.customTemplate))
  })
  handle('settings:save', 'main', (_, value: Settings) => {
    if (!value || !formats.includes(value.format) || typeof value.shortcut !== 'string' || value.shortcut.length > 80 || !/^(?=.*(?:Control|CommandOrControl|Alt|Shift)\+)[A-Za-z0-9+]+$/.test(value.shortcut)) throw new Error('快捷键需要包含 Ctrl、Alt 或 Shift，例如 Control+Alt+C')
    const customTemplate = validateCopyTemplate(value.customTemplate ?? state.settings.customTemplate)
    const changed = value.shortcut !== state.settings.shortcut
    const registered = state.shortcutAvailable && !changed
    if (!registered && !globalShortcut.register(value.shortcut, launchPick)) throw new Error('这个快捷键已被占用，请换一个组合。')
    const previous = state.settings.shortcut
    try { persist({ ...state, settings: { shortcut: value.shortcut, format: value.format, customTemplate }, shortcutAvailable: true }) }
    catch (error) { if (changed) globalShortcut.unregister(value.shortcut); throw error }
    if (changed) globalShortcut.unregister(previous)
    updateTray()
    return state
  })
  handle('history:clear', 'main', () => { persist({ ...state, history: [] }); return state })
  handle('history:remove', 'main', (_, hex) => { const normalized = normalizeHex(hex); persist({ ...state, history: state.history.filter(entry => entry.hex !== normalized) }); return state })
  handle('window:state', 'main', async () => { await fullscreenTransition.catch(() => {}); return getWindowState() })
  handle('window:action', 'main', (_, action) => windowAction(action))
}
function updateTray() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: '开始取色', click: launchPick, ...(state.shortcutAvailable ? { accelerator: state.settings.shortcut } : {}) },
    { label: '打开拾色', click: showMain }, { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]))
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (!picking) showMain() })
  app.on('before-quit', () => { quitting = true; finishPick() })
  app.on('will-quit', () => { globalShortcut.unregisterAll(); tray?.destroy() })
  app.on('window-all-closed', () => { if (!tray) app.quit() })
  app.whenReady().then(async () => {
    screenLocked = powerMonitor.getSystemIdleState(1) === 'locked'
    powerMonitor.on('lock-screen', () => {
      screenLocked = true
      if (picking) { finishPick(true); notifyError(new Error('屏幕已锁定，当前取色已取消。')) }
    })
    powerMonitor.on('unlock-screen', () => { screenLocked = false })
    app.setAppUserModelId('com.colorpicker.desktop')
    session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)
    loadState()
    try { state.shortcutAvailable = globalShortcut.register(state.settings.shortcut, launchPick) } catch { state.shortcutAvailable = false }
    registerIpc()
    await createMain()
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources/icon.png'))
    tray = new Tray(icon.resize({ width: 20, height: 20 }))
    tray.setToolTip('拾色 · Color Picker')
    tray.on('double-click', showMain)
    updateTray()
    const displayChanged = () => {
      if (picking) { finishPick(true); notifyError(new Error('显示器配置发生变化，请重新取色。')) }
    }
    screen.on('display-added', displayChanged)
    screen.on('display-removed', displayChanged)
    screen.on('display-metrics-changed', (_, __, changedMetrics) => {
      if (changedMetrics.some(metric => ['bounds', 'scaleFactor', 'rotation'].includes(metric))) displayChanged()
    })
  }).catch(error => { console.error(error); app.exit(1) })
}
