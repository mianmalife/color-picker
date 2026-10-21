import { _electron as electron } from 'playwright'
import { resolve, join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const root = resolve(import.meta.dirname, '..')
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const instance = await electron.launch({ executablePath: join(root, 'release/win-unpacked/Color Picker.exe'), env, timeout: 30000 })
try {
  const page = await instance.firstWindow()
  await page.getByTestId('pick-button').waitFor()
  assert.equal(await instance.evaluate(({ app }) => app.isPackaged), true)
  assert.equal(await page.evaluate(() => typeof window.picker.startPick), 'function')
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  await page.getByTestId('fullscreen-button').dispatchEvent('click')
  await page.waitForFunction(async () => (await window.picker.getWindowState()).fullscreen)
  await page.screenshot({ path: join(root, 'artifacts/packaged-fullscreen.png') })
  await instance.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  })
  await page.waitForFunction(async () => !(await window.picker.getWindowState()).fullscreen)
  await page.screenshot({ path: join(root, 'artifacts/main-packaged.png') })
  const historyBeforeCapture = (await page.evaluate(() => window.picker.getState())).history
  const target = await instance.evaluate(async ({ BrowserWindow, screen }) => {
    const display = screen.getPrimaryDisplay()
    const fixture = new BrowserWindow({ ...display.bounds, frame: false, alwaysOnTop: true, webPreferences: { sandbox: true } })
    fixture.setBounds(display.bounds); fixture.setAlwaysOnTop(true, 'screen-saver')
    await fixture.loadURL('data:text/html,' + encodeURIComponent('<body style="margin:0;background:#378BE0;height:100vh"></body>'))
    globalThis.__packagePixelFixture = fixture
    BrowserWindow.getAllWindows().find(win => win !== fixture).hide()
    fixture.show(); fixture.focus()
    const x = Math.floor(display.bounds.width / 4), y = Math.floor(display.bounds.height / 4)
    return { x, y, physical: screen.dipToScreenPoint({ x: display.bounds.x + x, y: display.bounds.y + y }) }
  })
  const reference = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', join(root, 'scripts/read-screen-pixels.ps1'), '-PointsJson', JSON.stringify([target.physical])], { windowsHide: true, timeout: 20000 })
  const expectedPixel = JSON.parse(reference.stdout.trim())[0]
  const pickerWait = instance.waitForEvent('window', { timeout: 20000 })
  await page.evaluate(() => window.picker.startPick())
  const picker = await pickerWait
  await picker.waitForURL(/mode=picker/)
  await picker.locator('.magnifier').waitFor({ state: 'attached' })
  await picker.evaluate(() => {
    for (const type of ['mousemove', 'mousedown', 'mouseleave', 'wheel', 'contextmenu']) window.addEventListener(type, event => { if (event.isTrusted) event.stopImmediatePropagation() }, true)
  })
  await picker.getByTestId('picker-overlay').dispatchEvent('mousemove', { clientX: target.x, clientY: target.y })
  await picker.waitForFunction(expected => document.querySelector('[data-testid="preview-hex"]')?.textContent === expected, expectedPixel)
  const startPoint = await picker.locator('.magnifier').evaluate(node => ({ x: Number(node.dataset.x), y: Number(node.dataset.y) }))
  await picker.getByTestId('picker-overlay').dispatchEvent('wheel', { deltaY: -120 })
  assert.equal(await picker.locator('.magnifier').getAttribute('data-grid'), '3')
  await picker.keyboard.press('ArrowRight')
  assert.equal(Number(await picker.locator('.magnifier').getAttribute('data-x')), startPoint.x + 1)
  assert.equal(await picker.getByTestId('preview-hex').textContent(), expectedPixel)
  await picker.evaluate(() => window.picker.cancelPick()).catch(error => { if (!picker.isClosed()) throw error })
  await instance.evaluate(({ BrowserWindow }) => {
    globalThis.__packagePixelFixture.destroy()
    const main = BrowserWindow.getAllWindows()[0]
    main.show(); main.focus()
  })
  assert.deepEqual((await page.evaluate(() => window.picker.getState())).history, historyBeforeCapture)
  console.log(`PASS Packaged capture preview matches Windows GetPixel (${expectedPixel}); cancel preserves history`)
  const selectedHex = await page.getByTestId('selected-hex').textContent()
  await page.getByRole('button', { name: '偏好设置' }).click()
  await page.getByLabel('默认复制格式').selectOption('custom')
  await page.getByLabel('自定义复制模板', { exact: true }).fill('color: {hexLower};')
  assert.equal(await page.getByTestId('template-preview').textContent(), `color: ${selectedHex.toLowerCase()};`)
  await page.getByRole('button', { name: /拾色板/ }).click()
  console.log('PASS Packaged wheel zoom, keyboard nudge and custom-template UI preview (settings not saved)')
  const historyBeforeLock = (await page.evaluate(() => window.picker.getState())).history
  await instance.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'))
  try {
    const lockedMessage = await page.evaluate(async () => { try { await window.picker.startPick(); return '' } catch (error) { return String(error) } })
    assert.ok(lockedMessage.includes('屏幕已锁定'))
    assert.equal(instance.windows().length, 1)
    assert.deepEqual((await page.evaluate(() => window.picker.getState())).history, historyBeforeLock)
  } finally { await instance.evaluate(({ powerMonitor }) => powerMonitor.emit('unlock-screen')) }
  await writeFile(join(root, 'artifacts/package-result.json'), JSON.stringify({ passed: true, packaged: true, appVersion: await instance.evaluate(({ app }) => app.getVersion()), nativePixelMatched: true, nativePixel: expectedPixel, controlsAndTemplatePreview: true, testedAt: new Date().toISOString() }, null, 2))
  console.log('PASS Packaged Windows EXE launches with isolated preload, fullscreen controls and first-launch lock protection (simulated OS event)')
} finally { await instance.close() }
