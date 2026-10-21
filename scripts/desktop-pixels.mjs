import { _electron as electron } from 'playwright'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '..')
const data = await mkdtemp(join(tmpdir(), 'color-picker-desktop-'))
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const instance = await electron.launch({ args: [root, `--smoke-data=${data}`], env, timeout: 45000 })
let originalClipboard
const samples = [], durations = []
try {
  const page = await instance.firstWindow()
  await page.getByTestId('pick-button').waitFor()
  originalClipboard = await instance.evaluate(({ clipboard }) => clipboard.readText())
  const environment = await instance.evaluate(async ({ BrowserWindow, screen, powerMonitor }) => {
    if (powerMonitor.getSystemIdleState(1) === 'locked') throw new Error('Windows screen is locked')
    const display = screen.getPrimaryDisplay()
    const fixture = new BrowserWindow({ ...display.bounds, frame: false, skipTaskbar: true, alwaysOnTop: true, webPreferences: { sandbox: true } })
    fixture.setBounds(display.bounds)
    fixture.setAlwaysOnTop(true, 'screen-saver')
    const colors = ['#048BE4', '#378BE0', '#BB89DF', '#4ECDC4', '#FFA940', '#FF0000', '#0000FF', '#808080']
    await fixture.loadURL('data:text/html,' + encodeURIComponent(`<html><body style="margin:0;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(2,1fr);width:100vw;height:100vh">${colors.map(color => `<div style="background:${color}"></div>`).join('')}</body></html>`))
    globalThis.__desktopReferenceFixture = fixture
    const main = BrowserWindow.getAllWindows().find(win => win !== fixture)
    main.on('hide', () => { if (!fixture.isDestroyed()) { fixture.showInactive(); fixture.setAlwaysOnTop(true, 'screen-saver') } })
    main.hide(); fixture.show(); fixture.focus()
    const points = colors.map((css, i) => ({ css, x: Math.floor(display.bounds.width * ((i % 4) + 0.5) / 4), y: Math.floor(display.bounds.height * (Math.floor(i / 4) + 0.5) / 2) }))
    return { display: { id: display.id, bounds: display.bounds, scaleFactor: display.scaleFactor, colorDepth: display.colorDepth }, points, nativePoints: points.map(p => screen.dipToScreenPoint({ x: display.bounds.x + p.x, y: display.bounds.y + p.y })) }
  })
  await page.waitForTimeout(500)
  const reference = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', join(root, 'scripts/read-screen-pixels.ps1'), '-PointsJson', JSON.stringify(environment.nativePoints)], { windowsHide: true, timeout: 20000 })
  const nativeColors = JSON.parse(reference.stdout.trim())
  assert.equal(nativeColors.length, environment.points.length)
  for (let i = 0; i < environment.points.length; i++) {
    const point = environment.points[i]
    const started = performance.now()
    const overlayWait = instance.waitForEvent('window', { timeout: 20000 })
    await page.evaluate(() => window.picker.startPick())
    const picker = await overlayWait
    await picker.waitForURL(/mode=picker/)
    await picker.locator('.magnifier').waitFor({ state: 'attached' })
    await picker.getByTestId('picker-overlay').dispatchEvent('mousemove', { clientX: point.x, clientY: point.y })
    await picker.waitForFunction(expected => document.querySelector('[data-testid="preview-hex"]')?.textContent === expected, nativeColors[i])
    durations.push(Math.round(performance.now() - started))
    const frame = await picker.evaluate(({ x, y }) => {
      const source = document.querySelector('.screen-canvas')
      const px = Math.floor(x * source.width / innerWidth), py = Math.floor(y * source.height / innerHeight)
      return [...source.getContext('2d').getImageData(px, py, 1, 1).data]
    }, point)
    const canvasHex = '#' + frame.slice(0, 3).map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()
    assert.equal(canvasHex, nativeColors[i], 'Canvas pixels must match the native Windows sample')
    await picker.getByTestId('picker-overlay').dispatchEvent('mousedown', { button: 0, clientX: point.x, clientY: point.y })
    await page.waitForFunction(expected => document.querySelector('[data-testid="selected-hex"]')?.textContent === expected, nativeColors[i])
    assert.equal(await instance.evaluate(({ clipboard }) => clipboard.readText()), nativeColors[i])
    samples.push({ css: point.css, nativeWindows: nativeColors[i], canvas: canvasHex, previewAndClipboard: nativeColors[i] })
    console.log(`PASS ${point.css}: Windows=${nativeColors[i]}, canvas/preview/commit/clipboard identical`)
  }
  await mkdir(join(root, 'artifacts'), { recursive: true })
  await writeFile(join(root, 'artifacts/desktop-pixels-result.json'), JSON.stringify({ passed: true, testedAt: new Date().toISOString(), environment, samples, captureReadyMs: durations }, null, 2))
  console.log('CAPTURE_READY_MS', JSON.stringify(durations))
} finally {
  if (originalClipboard !== undefined) await instance.evaluate(({ clipboard }, value) => clipboard.writeText(value), originalClipboard).catch(() => {})
  await instance.close()
  await rm(data, { recursive: true, force: true })
}
