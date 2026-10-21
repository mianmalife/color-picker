import { _electron as electron } from 'playwright'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '..')
const packaged = process.argv.includes('--packaged')
const artifacts = join(root, 'artifacts')
const data = await mkdtemp(join(tmpdir(), 'color-picker-window-controls-'))
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
let instance
const results = []
try {
  instance = await electron.launch(packaged
    ? { executablePath: join(root, 'release/win-unpacked/Color Picker.exe'), env, timeout: 30000 }
    : { args: [root, `--smoke-data=${data}`], env, timeout: 30000 })
  const page = await instance.firstWindow()
  page.setDefaultTimeout(5000)
  await page.getByTestId('fullscreen-button').waitFor()
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByTestId('fullscreen-button').click()
    await page.waitForFunction(async () => (await window.picker.getWindowState()).fullscreen)
    const maximize = page.getByTestId('maximize-button')
    assert.equal(await maximize.isDisabled(), true)
    await maximize.hover()
    await page.waitForTimeout(1200)
    const cursor = await maximize.evaluate(button => getComputedStyle(button).cursor)
    const started = Date.now()
    await Promise.race([
      page.evaluate(async () => { await window.picker.getState(); await new Promise(resolve => requestAnimationFrame(resolve)); return true }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Hover blocked the renderer or main-process IPC')), 3000); timer.unref() })
    ])
    const responsiveMs = Date.now() - started
    results.push({ cycle: cycle + 1, cursor, responsiveMs })
    console.log(JSON.stringify(results.at(-1)))
    assert.notEqual(cursor, 'wait', 'Disabled maximize must not show the loading cursor')
    assert.notEqual(cursor, 'progress', 'Disabled maximize must not show the loading cursor')
    assert.match(await maximize.getAttribute('title'), /退出全屏/)
    await instance.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    })
    await page.waitForFunction(async () => !(await window.picker.getWindowState()).fullscreen)
    assert.equal(await maximize.isEnabled(), true)
    await maximize.click()
    await page.waitForFunction(async () => (await window.picker.getWindowState()).maximized)
    await maximize.click()
    await page.waitForFunction(async () => !(await window.picker.getWindowState()).maximized)
  }
  await mkdir(artifacts, { recursive: true })
  await writeFile(join(artifacts, packaged ? 'packaged-window-controls-result.json' : 'window-controls-result.json'), JSON.stringify({ passed: true, packaged, results }, null, 2))
  console.log('PASS Fullscreen maximize hover remains responsive; Escape and maximize/restore work across three cycles')
} finally {
  if (instance) await instance.close()
  await rm(data, { recursive: true, force: true })
}
