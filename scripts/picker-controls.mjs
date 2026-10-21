import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const data = await mkdtemp(join(tmpdir(), 'color-picker-controls-'))
const artifacts = join(root, 'artifacts')
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const checks = []
let instance, page, originalClipboard
const template = '--picked: {hexLower};\n/* {r},{g},{b} */'
const formatted = hex => `--picked: ${hex.toLowerCase()};\n/* ${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',')} */`
function check(name) { checks.push(name); console.log('PASS', name) }
async function launch() {
  instance = await electron.launch({ args: [root, `--smoke-data=${data}`], env, timeout: 45000 })
  page = await instance.firstWindow()
  await page.getByTestId('pick-button').waitFor()
}
async function overlay() {
  const wait = instance.waitForEvent('window', { timeout: 20000 })
  await page.evaluate(() => window.picker.startPick())
  const picker = await wait
  await picker.waitForURL(/mode=picker/)
  await picker.locator('.magnifier').waitFor({ state: 'attached' })
  // The shared desktop may be in use. Isolate physical pointer events in this
  // test window only; synthetic fixture events still exercise the application.
  await picker.evaluate(() => {
    for (const type of ['mousemove', 'mousedown', 'mouseleave', 'wheel', 'contextmenu']) window.addEventListener(type, event => { if (event.isTrusted) event.stopImmediatePropagation() }, true)
  })
  await picker.evaluate(async () => { window.__controlsFrame = await window.picker.getCapture() })
  return picker
}
async function coordinates(picker) {
  return picker.locator('.magnifier').evaluate(node => ({ x: Number(node.dataset.x), y: Number(node.dataset.y), grid: Number(node.dataset.grid) }))
}
async function expectedAt(picker, point) {
  return picker.evaluate(({ x, y }) => {
    const frame = window.__controlsFrame, offset = (y * frame.width + x) * 4
    return '#' + [...frame.pixels.slice(offset, offset + 3)].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
  }, point)
}
async function move(picker, x, y) {
  await picker.getByTestId('picker-overlay').dispatchEvent('mousemove', { clientX: x, clientY: y })
  await picker.waitForTimeout(35)
  return coordinates(picker)
}
async function assertCommitted(hex) {
  await page.waitForFunction(expected => document.querySelector('[data-testid="selected-hex"]')?.textContent === expected, hex)
  assert.equal(await instance.evaluate(({ clipboard }) => clipboard.readText()), formatted(hex))
  assert.equal((await page.evaluate(() => window.picker.getState())).history[0].hex, hex)
}
try {
  await mkdir(artifacts, { recursive: true })
  await writeFile(join(data, 'colors.json'), JSON.stringify({ version: 1, history: [], settings: { shortcut: 'Control+Alt+Shift+F8', format: 'hex' } }))
  await launch()
  originalClipboard = await instance.evaluate(({ clipboard }) => clipboard.readText())
  assert.equal((await page.evaluate(() => window.picker.getState())).settings.customTemplate, '{hex}')
  check('Existing settings without a template migrate with defaults')
  await page.getByRole('button', { name: '偏好设置' }).click()
  await page.getByLabel('默认复制格式').selectOption('custom')
  await page.getByLabel('复制模板预设').selectOption({ label: '小写 HEX' })
  assert.equal(await page.getByLabel('自定义复制模板', { exact: true }).inputValue(), '{hexLower}')
  assert.equal(await page.getByTestId('template-preview').textContent(), '#a3e635')
  await page.getByLabel('自定义复制模板', { exact: true }).fill('{unknown}')
  await page.getByRole('alert').filter({ hasText: '未知占位符' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '保存设置' }).isDisabled(), true)
  const before = await page.evaluate(() => window.picker.getState())
  const rejected = await page.evaluate(async settings => {
    try { await window.picker.saveSettings({ ...settings, shortcut: 'Control+Alt+Shift+F7', format: 'custom', customTemplate: '{bad}' }); return false } catch { return true }
  }, before.settings)
  assert.equal(rejected, true)
  assert.deepEqual(await page.evaluate(() => window.picker.getState()), before)
  assert.equal(await instance.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+Shift+F7')), false)
  check('Preset preview and validation reject bad templates before changing settings or shortcuts')
  await page.getByLabel('自定义复制模板', { exact: true }).fill(template)
  assert.equal(await page.getByTestId('template-preview').textContent(), formatted('#A3E635'))
  await page.screenshot({ path: join(artifacts, 'custom-template-settings.png') })
  await page.getByRole('button', { name: '保存设置' }).click()
  await page.getByRole('status').filter({ hasText: '设置已保存' }).waitFor()
  await page.getByRole('button', { name: /拾色板/ }).click()
  await page.getByLabel('输入 HEX 预览').fill('#048BE4')
  await page.getByRole('button', { name: '预览颜色', exact: true }).click()
  await page.getByTestId('custom-copy').click()
  assert.equal(await instance.evaluate(({ clipboard }) => clipboard.readText()), formatted('#048BE4'))
  await page.locator('.value-card').filter({ hasText: 'RGB' }).click()
  assert.equal(await instance.evaluate(({ clipboard }) => clipboard.readText()), 'rgb(4, 139, 228)')
  check('Saved multiline templates copy correctly while built-in format cards retain their format')

  await instance.evaluate(async ({ BrowserWindow, screen, powerMonitor }) => {
    if (powerMonitor.getSystemIdleState(1) === 'locked') throw new Error('Windows screen is locked')
    const fixture = new BrowserWindow({ ...screen.getPrimaryDisplay().bounds, frame: false, alwaysOnTop: true, webPreferences: { sandbox: true } })
    fixture.setBounds(screen.getPrimaryDisplay().bounds); fixture.setAlwaysOnTop(true, 'screen-saver')
    const html = `<body style="margin:0"><canvas style="width:100vw;height:100vh;image-rendering:pixelated"></canvas><script>const c=document.querySelector('canvas');c.width=Math.round(innerWidth*devicePixelRatio);c.height=Math.round(innerHeight*devicePixelRatio);const g=c.getContext('2d');const d=g.createImageData(c.width,c.height);for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;d.data[i]=x%256;d.data[i+1]=y%256;d.data[i+2]=(x+y)%256;d.data[i+3]=255;}g.putImageData(d,0,0);</script>`
    await fixture.loadURL('data:text/html,' + encodeURIComponent(html))
    globalThis.__controlsFixture = fixture
    const main = BrowserWindow.getAllWindows().find(win => win !== fixture)
    main.on('hide', () => { if (!fixture.isDestroyed()) { fixture.showInactive(); fixture.setAlwaysOnTop(true, 'screen-saver') } })
    main.hide(); fixture.show(); fixture.focus()
  })
  let picker = await overlay()
  const start = await move(picker, 400, 300)
  const expectedStart = await expectedAt(picker, start)
  await picker.waitForFunction(hex => document.querySelector('[data-testid="preview-hex"]')?.textContent === hex, expectedStart)
  for (const [deltaY, grid] of [[-120, 3], [-120, 3], [120, 11], [120, 33], [120, 33], [-120, 11]]) {
    await picker.getByTestId('picker-overlay').dispatchEvent('wheel', { deltaY })
    assert.deepEqual(await coordinates(picker), { x: start.x, y: start.y, grid })
    assert.equal(await picker.getByTestId('preview-hex').textContent(), expectedStart)
    const center = await picker.locator('.magnifier>canvas').evaluate(c => [...c.getContext('2d').getImageData(99, 99, 1, 1).data].slice(0, 3))
    assert.equal('#' + center.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase(), expectedStart)
  }
  check('Wheel zoom clamps at 6x/18x/66x and preserves the sampled center pixel at every level')
  await picker.keyboard.press('ArrowRight')
  await picker.keyboard.press('ArrowDown')
  await picker.keyboard.press('Shift+ArrowLeft')
  const nudged = await coordinates(picker)
  assert.deepEqual(nudged, { x: start.x - 9, y: start.y + 1, grid: 11 })
  assert.equal(await picker.locator('.pixel-crosshair').isVisible(), true)
  const expectedNudged = await expectedAt(picker, nudged)
  assert.notEqual(expectedNudged, expectedStart)
  assert.equal(await picker.getByTestId('preview-hex').textContent(), expectedNudged)
  await picker.screenshot({ path: join(artifacts, 'picker-keyboard-zoom.png') })
  await picker.keyboard.press('Enter').catch(error => { if (!picker.isClosed()) throw error })
  await assertCommitted(expectedNudged)
  check('Arrow keys move physical pixels, Shift moves ten, and Enter commits the displayed pixel using the custom template')

  picker = await overlay()
  const second = await move(picker, 400, 300)
  await picker.keyboard.press('ArrowRight')
  await picker.getByTestId('picker-overlay').dispatchEvent('mousemove', { clientX: 400, clientY: 300 })
  assert.equal((await coordinates(picker)).x, second.x + 1)
  const expectedClick = await expectedAt(picker, await coordinates(picker))
  await picker.getByTestId('picker-overlay').dispatchEvent('mousedown', { button: 0, clientX: 400, clientY: 300 })
  await assertCommitted(expectedClick)
  check('Clicking after keyboard nudging commits the virtual selection instead of the stationary mouse position')

  picker = await overlay()
  await move(picker, 0, 0)
  await picker.keyboard.press('ArrowLeft'); await picker.keyboard.press('ArrowUp')
  assert.deepEqual(await coordinates(picker), { x: 0, y: 0, grid: 11 })
  for (const deltaY of [-120, 120, 120]) {
    await picker.getByTestId('picker-overlay').dispatchEvent('wheel', { deltaY })
    const center = await picker.locator('.magnifier>canvas').evaluate(c => [...c.getContext('2d').getImageData(99, 99, 1, 1).data].slice(0, 3))
    assert.equal('#' + center.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase(), await expectedAt(picker, { x: 0, y: 0 }))
  }
  const dimensions = await picker.evaluate(() => ({ w: innerWidth, h: innerHeight, width: window.__controlsFrame.width, height: window.__controlsFrame.height }))
  await move(picker, dimensions.w - 1, dimensions.h - 1)
  await picker.keyboard.press('Shift+ArrowRight'); await picker.keyboard.press('Shift+ArrowDown')
  const edge = await coordinates(picker)
  assert.equal(edge.x, dimensions.width - 1); assert.equal(edge.y, dimensions.height - 1)
  for (const deltaY of [-120, -120, 120, 120]) {
    await picker.getByTestId('picker-overlay').dispatchEvent('wheel', { deltaY })
    const center = await picker.locator('.magnifier>canvas').evaluate(c => [...c.getContext('2d').getImageData(99, 99, 1, 1).data].slice(0, 3))
    assert.equal('#' + center.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase(), await expectedAt(picker, edge))
  }
  await move(picker, 500, 350)
  assert.equal(await picker.locator('.pixel-crosshair').count(), 0)
  const resumed = await coordinates(picker)
  assert.equal(resumed.x, Math.floor(500 * dimensions.width / dimensions.w))
  const savedHistory = (await page.evaluate(() => window.picker.getState())).history
  const savedClipboard = await instance.evaluate(({ clipboard }) => clipboard.readText())
  await picker.keyboard.press('Escape').catch(error => { if (!picker.isClosed()) throw error })
  assert.deepEqual((await page.evaluate(() => window.picker.getState())).history, savedHistory)
  assert.equal(await instance.evaluate(({ clipboard }) => clipboard.readText()), savedClipboard)
  check('Nudges clamp both screen corners, mouse motion restores mouse selection, and Escape preserves history/clipboard')
  await instance.close(); instance = undefined
  await launch()
  const restored = await page.evaluate(() => window.picker.getState())
  assert.equal(restored.settings.format, 'custom'); assert.equal(restored.settings.customTemplate, template)
  assert.deepEqual(restored.history, savedHistory)
  check('Custom template and picked colors survive a full application restart')
  await instance.close(); instance = undefined
  const invalid = JSON.parse(await readFile(join(data, 'colors.json'), 'utf8'))
  invalid.settings.customTemplate = '{broken}'
  await writeFile(join(data, 'colors.json'), JSON.stringify(invalid))
  await launch()
  const recovered = await page.evaluate(() => window.picker.getState())
  assert.equal(recovered.settings.format, 'hex'); assert.equal(recovered.settings.customTemplate, '{hex}')
  assert.deepEqual(recovered.history, savedHistory)
  check('Invalid persisted templates recover to HEX without discarding history')
  await writeFile(join(artifacts, 'picker-controls-result.json'), JSON.stringify({ passed: true, checks, testedAt: new Date().toISOString() }, null, 2))
} catch (error) {
  await writeFile(join(artifacts, 'picker-controls-result.json'), JSON.stringify({ passed: false, checks, error: String(error), testedAt: new Date().toISOString() }, null, 2))
  throw error
} finally {
  if (instance) {
    if (originalClipboard !== undefined) await instance.evaluate(({ clipboard }, value) => clipboard.writeText(value), originalClipboard).catch(() => {})
    await instance.close().catch(() => {})
  }
  await rm(data, { recursive: true, force: true })
}
