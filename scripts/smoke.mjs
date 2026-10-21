import { _electron as electron } from 'playwright'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '..')
const artifacts = join(root, 'artifacts')
const data = await mkdtemp(join(tmpdir(), 'color-picker-smoke-'))
await mkdir(artifacts, { recursive: true })
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
let instance, originalClipboard, environment
const checks = []
function check(name) { checks.push(name); console.log(`PASS ${name}`) }
async function launch() {
  instance = await electron.launch({ args: [root, `--smoke-data=${data}`], env, timeout: 45000 })
  const page = await instance.firstWindow()
  page.on('pageerror', error => console.error('PAGE ERROR', error))
  await page.getByTestId('pick-button').waitFor()
  await page.waitForFunction(() => !!window.picker)
  await page.evaluate(() => window.picker.onError(message => console.error('APP ERROR:', message)))
  page.on('console', message => { if (message.type() === 'error') console.error('RENDERER:', message.text()) })
  return page
}
async function overlay() {
  const page = await instance.waitForEvent('window', { timeout: 20000 })
  await page.waitForURL(/mode=picker/, { timeout: 20000 })
  await page.locator('.magnifier').waitFor({ state: 'attached', timeout: 20000 })
  await page.waitForTimeout(300)
  return page
}
try {
  let page = await launch()
  environment = await instance.evaluate(({ screen, powerMonitor }) => ({
    session: powerMonitor.getSystemIdleState(1),
    displays: screen.getAllDisplays().map(display => ({ id: display.id, bounds: display.bounds, scaleFactor: display.scaleFactor, colorDepth: display.colorDepth }))
  }))
  console.log('ENVIRONMENT', JSON.stringify(environment))
  originalClipboard = await instance.evaluate(({ clipboard }) => clipboard.readText())
  const initial = await page.evaluate(() => window.picker.getState())
  assert.equal(initial.history.length, 0)
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  await page.screenshot({ path: join(artifacts, 'main-empty.png') })
  check('Production window renders with isolated preload and empty history')
  if (await instance.evaluate(({ powerMonitor }) => powerMonitor.getSystemIdleState(1) === 'locked')) {
    const message = await page.evaluate(async () => { try { await window.picker.startPick(); return '' } catch (error) { return String(error) } })
    assert.ok(message.includes('屏幕已锁定'))
    assert.equal(instance.windows().length, 1)
    check('Locked session rejects sampling without creating an overlay')
    throw new Error('ENVIRONMENT_LOCKED: 请解锁 Windows 后重跑真实桌面取色测试。')
  }
  const denied = await page.evaluate(async () => { try { await window.picker.getCapture(); return false } catch { return true } })
  assert.equal(denied, true)
  check('Main window cannot access an overlay screenshot')

  // Inject OS notifications in this isolated process; never lock the user's computer.
  await instance.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'))
  const initialLockMessage = await page.evaluate(async () => { try { await window.picker.startPick(); return '' } catch (error) { return String(error) } })
  assert.ok(initialLockMessage.includes('屏幕已锁定'), 'Lock protection must work before saving any settings')
  assert.equal(instance.windows().length, 1)
  await instance.evaluate(({ powerMonitor }) => powerMonitor.emit('unlock-screen'))
  check('First-launch lock notification blocks capture before any settings are saved (simulated OS event)')

  const lockListenerCount = await instance.evaluate(({ powerMonitor }) => powerMonitor.listenerCount('lock-screen'))
  await instance.evaluate(({ BrowserWindow, powerMonitor }) => {
    BrowserWindow.getAllWindows()[0].once('hide', () => setTimeout(() => powerMonitor.emit('lock-screen'), 0))
  })
  await page.evaluate(() => window.picker.startPick())
  await page.getByRole('status').filter({ hasText: '屏幕已锁定' }).waitFor()
  assert.equal(instance.windows().length, 1)
  assert.equal((await page.evaluate(() => window.picker.getState())).history.length, 0)
  await instance.evaluate(({ powerMonitor }) => powerMonitor.emit('unlock-screen'))
  check('Lock during screenshot preparation aborts without leaving an overlay (simulated OS event)')

  async function expectWindowState(key, value) {
    await page.waitForFunction(async ({ key, value }) => (await window.picker.getWindowState())[key] === value, { key, value })
  }
  async function nativeKey(keyCode) {
    await instance.evaluate(({ BrowserWindow }, keyCode) => {
      const win = BrowserWindow.getAllWindows().find(win => !win.webContents.getURL().includes('mode=picker'))
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    }, keyCode)
  }
  await page.getByTestId('fullscreen-button').dispatchEvent('click')
  await expectWindowState('fullscreen', true)
  assert.equal(await page.getByTestId('fullscreen-button').getAttribute('aria-pressed'), 'true')
  await nativeKey('Escape')
  await expectWindowState('fullscreen', false)
  await page.getByLabel('最大化', { exact: true }).dispatchEvent('click')
  await expectWindowState('maximized', true)
  await page.getByLabel('还原窗口', { exact: true }).dispatchEvent('click')
  await expectWindowState('maximized', false)
  await page.evaluate(() => Promise.all([window.picker.windowAction('toggle-fullscreen'), window.picker.windowAction('toggle-fullscreen')]))
  await expectWindowState('fullscreen', false)
  await nativeKey('F11')
  await expectWindowState('fullscreen', true)
  await page.screenshot({ path: join(artifacts, 'main-fullscreen.png') })
  check('Fullscreen button, F11, Escape and maximize/restore synchronize native window state')

  await instance.evaluate(async ({ BrowserWindow, screen }) => {
    const fixture = new BrowserWindow({ ...screen.getPrimaryDisplay().bounds, frame: false, fullscreenable: false, minimizable: false, backgroundColor: '#123456', skipTaskbar: true, alwaysOnTop: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    fixture.setBounds(screen.getPrimaryDisplay().bounds)
    fixture.setAlwaysOnTop(true, 'screen-saver')
    await fixture.loadURL('data:text/html,' + encodeURIComponent('<html><body style="margin:0;background:#123456;width:100vw;height:100vh"><div style="position:absolute;left:0;top:0;width:160px;height:160px;background:#E53935"></div><div style="position:absolute;right:0;top:0;width:160px;height:160px;background:#22C55E"></div></body></html>'))
    globalThis.__smokeFixture = fixture
    const main = BrowserWindow.getAllWindows().find(win => win !== fixture)
    // Native fullscreen activation can change sibling window Z-order on Windows.
    main.on('hide', () => { if (!fixture.isDestroyed()) { if (fixture.isMinimized()) fixture.restore(); fixture.showInactive(); fixture.setAlwaysOnTop(true, 'screen-saver') } })
    main.show(); main.focus()
  })
  await page.waitForTimeout(500)
  const overlayWait = overlay()
  await page.getByTestId('pick-button').dispatchEvent('click')
  let picker = await overlayWait
  await picker.getByTestId('picker-overlay').dispatchEvent('mousemove', { clientX: 400, clientY: 300 })
  await picker.waitForTimeout(100)
  assert.equal(await picker.getByTestId('preview-hex').textContent(), '#123456')
  await picker.screenshot({ path: join(artifacts, 'picker-overlay.png') })
  await picker.getByTestId('picker-overlay').dispatchEvent('mousedown', { button: 0, clientX: 400, clientY: 300 })
  await page.waitForFunction(() => document.querySelector('[data-testid="selected-hex"]')?.textContent === '#123456', { timeout: 20000 })
  let stored = await page.evaluate(() => window.picker.getState())
  assert.equal(stored.history[0].hex, '#123456')
  assert.equal(await instance.evaluate(({ clipboard }) => clipboard.readText()), '#123456')
  check('Real desktop capture → physical pixel → history → HEX clipboard')
  await expectWindowState('fullscreen', true)
  check('Picking from fullscreen hides the application before capture and restores fullscreen')
  await page.evaluate(() => window.picker.windowAction('exit-fullscreen'))
  await expectWindowState('fullscreen', false)

  // A spatial fixture catches coordinate/channel bugs that a solid-color screen cannot expose.
  let checkedWorkArea = false
  for (const [position, expected] of [['left', '#E53935'], ['right', '#22C55E'], ['left', '#E53935']]) {
    const nextOverlay = overlay()
    await page.getByTestId('pick-button').dispatchEvent('click')
    picker = await nextOverlay
    if (!checkedWorkArea) {
      await instance.evaluate(({ screen }) => screen.emit('display-metrics-changed', {}, screen.getPrimaryDisplay(), ['workArea']))
      await picker.waitForTimeout(100)
      assert.equal(picker.isClosed(), false)
      checkedWorkArea = true
    }
    const rejected = await picker.evaluate(async () => {
      const image = await window.picker.getCapture()
      const points = [[-1, 0], [image.width, 0], [0, image.height], [0.5, 0], [NaN, 0]]
      return Promise.all(points.map(async ([x, y]) => { try { await window.picker.selectPixel(x, y); return false } catch { return true } }))
    })
    assert.ok(rejected.every(Boolean))
    const point = await picker.evaluate(position => ({ clientX: position === 'left' ? 80 : innerWidth - 80, clientY: 80 }), position)
    await picker.getByTestId('picker-overlay').dispatchEvent('mousemove', point)
    await picker.waitForFunction(expected => document.querySelector('[data-testid="preview-hex"]')?.textContent === expected, expected)
    await picker.getByTestId('picker-overlay').dispatchEvent('mousedown', { button: 0, ...point })
    await page.waitForFunction(expected => document.querySelector('[data-testid="selected-hex"]')?.textContent === expected, expected)
    assert.equal(await instance.evaluate(({ clipboard }) => clipboard.readText()), expected)
  }
  stored = await page.evaluate(() => window.picker.getState())
  assert.equal(stored.history.length, 3)
  assert.equal(stored.history[0].hex, '#E53935')
  check('Corner preview matches committed pixels, invalid coordinates are rejected and repeated colors deduplicate')
  check('Taskbar work-area changes do not cancel an active capture')
  await instance.evaluate(() => globalThis.__smokeFixture.destroy())
  await page.screenshot({ path: join(artifacts, 'main-picked.png') })
  assert.equal(await instance.evaluate(({ globalShortcut }, shortcut) => globalShortcut.isRegistered(shortcut), stored.settings.shortcut), stored.shortcutAvailable)
  check('Global shortcut registration matches application state')

  const cancelWait = overlay()
  await page.evaluate(() => window.picker.windowAction('toggle-fullscreen'))
  await expectWindowState('fullscreen', true)
  await page.getByTestId('pick-button').dispatchEvent('click')
  picker = await cancelWait
  await picker.keyboard.press('Escape').catch(error => { if (!picker.isClosed()) throw error })
  await page.waitForTimeout(400)
  assert.equal((await page.evaluate(() => window.picker.getState())).history.length, 3)
  await expectWindowState('fullscreen', true)
  check('Escape closes capture without adding a color')

  const lockWait = overlay()
  await page.getByTestId('pick-button').dispatchEvent('click')
  picker = await lockWait
  await instance.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'))
  await page.getByRole('status').filter({ hasText: '屏幕已锁定' }).waitFor()
  assert.equal(instance.windows().length, 1)
  assert.equal((await page.evaluate(() => window.picker.getState())).history.length, 3)
  await instance.evaluate(({ powerMonitor }) => powerMonitor.emit('unlock-screen'))
  await expectWindowState('fullscreen', true)
  check('Lock cancels all active overlays, preserves history and restores fullscreen (simulated OS event)')

  // Explicit decoder failure must close every overlay and immediately recover the main window.
  const failureWait = overlay()
  await page.getByTestId('pick-button').dispatchEvent('click')
  picker = await failureWait
  await picker.evaluate(() => window.picker.failPick('测试画面加载失败')).catch(error => { if (!picker.isClosed()) throw error })
  await page.getByRole('status').filter({ hasText: '测试画面加载失败' }).waitFor()
  assert.equal((await page.evaluate(() => window.picker.getState())).history.length, 3)
  await expectWindowState('fullscreen', true)
  await nativeKey('Escape')
  await expectWindowState('fullscreen', false)
  check('Capture failure recovers the main window immediately without mutating history')

  const layoutWait = overlay()
  await page.getByTestId('pick-button').dispatchEvent('click')
  picker = await layoutWait
  await instance.evaluate(({ screen }) => screen.emit('display-metrics-changed', {}, screen.getPrimaryDisplay(), ['bounds']))
  await page.getByRole('status').filter({ hasText: '显示器配置发生变化' }).waitFor()
  assert.equal((await page.evaluate(() => window.picker.getState())).history.length, 3)
  check('Display geometry changes cancel stale captures and preserve history')

  await page.evaluate(() => window.picker.windowAction('minimize'))
  const minimizedWait = overlay()
  await page.evaluate(() => window.picker.startPick())
  picker = await minimizedWait
  await picker.keyboard.press('Escape').catch(error => { if (!picker.isClosed()) throw error })
  await page.waitForTimeout(300)
  assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), true)
  await instance.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.restore(); win.show(); win.focus() })
  check('Canceling a background capture preserves the previously minimized window')

  await page.getByRole('button', { name: '偏好设置' }).click()
  await page.getByLabel('全局快捷键').dispatchEvent('keydown', { key: 'F9', code: 'F9', ctrlKey: true, altKey: true, shiftKey: true })
  await page.getByLabel('默认复制格式').selectOption('rgb')
  await page.getByRole('button', { name: '保存设置' }).click()
  await page.getByRole('status').filter({ hasText: '设置已保存' }).waitFor()
  await page.screenshot({ path: join(artifacts, 'settings.png') })
  await page.evaluate(() => window.picker.copy('#123456', 'rgb'))
  assert.equal(await instance.evaluate(({ clipboard }) => clipboard.readText()), 'rgb(18, 52, 86)')
  const persisted = JSON.parse(await readFile(join(data, 'colors.json'), 'utf8'))
  assert.equal(persisted.settings.format, 'rgb')
  check('Settings UI, RGB clipboard and atomic JSON persistence')
  await page.evaluate(async () => {
    const { settings } = await window.picker.getState()
    for (let i = 0; i < 3; i++) await window.picker.saveSettings(settings)
  })
  assert.equal(await instance.evaluate(({ powerMonitor }) => powerMonitor.listenerCount('lock-screen')), lockListenerCount)
  check('Repeated settings saves do not add lock-screen listeners')

  await instance.evaluate(({ clipboard }, text) => clipboard.writeText(text), originalClipboard)
  await instance.close(); instance = undefined
  page = await launch()
  stored = await page.evaluate(() => window.picker.getState())
  assert.equal(stored.history[0].hex, '#E53935')
  assert.equal(stored.settings.format, 'rgb')
  check('History and settings survive a full application restart')
  await page.getByLabel('搜索颜色').fill('not-a-color')
  await page.getByText('没有找到匹配的颜色').waitFor()
  await page.getByLabel('搜索颜色').fill('123456')
  await page.getByRole('button', { name: '选择 #123456', exact: true }).waitFor()
  await page.evaluate(() => window.picker.clearHistory())
  assert.equal((await page.evaluate(() => window.picker.getState())).history.length, 0)
  check('History search and clear')

  // Verify viewport extrema against screenshot pixels, independently of fixture placement.
  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    const edgeWait = overlay()
    await page.getByTestId('pick-button').dispatchEvent('click')
    picker = await edgeWait
    const target = await picker.evaluate(corner => {
      const canvas = document.querySelector('.screen-canvas')
      const right = corner.endsWith('right'), bottom = corner.startsWith('bottom')
      const pixel = canvas.getContext('2d').getImageData(right ? canvas.width - 1 : 0, bottom ? canvas.height - 1 : 0, 1, 1).data
      return {
        expected: '#' + [...pixel].slice(0, 3).map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase(),
        clipboard: `rgb(${[...pixel].slice(0, 3).join(', ')})`,
        point: { clientX: right ? innerWidth - 0.1 : 0, clientY: bottom ? innerHeight - 0.1 : 0 }
      }
    }, corner)
    await picker.getByTestId('picker-overlay').dispatchEvent('mousemove', target.point)
    await picker.waitForFunction(expected => document.querySelector('[data-testid="preview-hex"]')?.textContent === expected, target.expected)
    const closed = picker.waitForEvent('close')
    await picker.getByTestId('picker-overlay').dispatchEvent('mousedown', { button: 0, ...target.point }).catch(error => { if (!picker.isClosed()) throw error })
    await closed
    await page.waitForFunction(expected => document.querySelector('[data-testid="selected-hex"]')?.textContent === expected, target.expected)
    assert.equal(await instance.evaluate(({ clipboard }) => clipboard.readText()), target.clipboard)
  }
  check('All four screen corners map exactly from preview to sampled pixel and clipboard')

  const beforeCancel = await page.evaluate(() => window.picker.getState())
  const beforeClipboard = await instance.evaluate(({ clipboard }) => clipboard.readText())
  const rightClickWait = overlay()
  await page.getByTestId('pick-button').dispatchEvent('click')
  picker = await rightClickWait
  const rightClosed = picker.waitForEvent('close')
  await picker.getByTestId('picker-overlay').dispatchEvent('contextmenu', { button: 2 }).catch(error => { if (!picker.isClosed()) throw error })
  await rightClosed
  assert.deepEqual((await page.evaluate(() => window.picker.getState())).history, beforeCancel.history)
  assert.equal(await instance.evaluate(({ clipboard }) => clipboard.readText()), beforeClipboard)
  check('Right-click cancel leaves history and clipboard unchanged')

  await page.getByLabel('关闭到托盘').click()
  assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false)
  check('Close keeps application alive in tray')
  await instance.evaluate(({ app }) => app.emit('second-instance', {}, [], ''))
  await page.evaluate(() => window.picker.windowAction('toggle-fullscreen'))
  await expectWindowState('fullscreen', true)
  await page.evaluate(() => window.picker.windowAction('close'))
  const hiddenWait = overlay()
  await page.evaluate(() => window.picker.startPick())
  picker = await hiddenWait
  await picker.keyboard.press('Escape').catch(error => { if (!picker.isClosed()) throw error })
  await page.waitForTimeout(200)
  assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false)
  await instance.evaluate(({ app }) => app.emit('second-instance', {}, [], ''))
  await expectWindowState('fullscreen', true)
  await page.evaluate(() => window.picker.windowAction('exit-fullscreen'))
  check('Canceling a tray capture preserves fullscreen when the main window is reopened')
  await writeFile(join(artifacts, 'smoke-result.json'), JSON.stringify({ passed: true, environment, checks, testedAt: new Date().toISOString() }, null, 2))
} catch (error) {
  await writeFile(join(artifacts, 'smoke-result.json'), JSON.stringify({ passed: false, environment, blocked: String(error).includes('ENVIRONMENT_LOCKED') ? 'windows-session-locked' : null, checks, error: String(error) }, null, 2))
  throw error
} finally {
  if (instance) {
    if (originalClipboard !== undefined) await instance.evaluate(({ clipboard }, text) => clipboard.writeText(text), originalClipboard).catch(() => {})
    await instance.close().catch(() => {})
  }
  await rm(data, { recursive: true, force: true })
}
