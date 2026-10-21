import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, PickerApi, WindowState } from '../src/types'

const api: PickerApi = {
  getState: () => ipcRenderer.invoke('state:get'),
  startPick: () => ipcRenderer.invoke('pick:start'),
  getCapture: () => ipcRenderer.invoke('pick:capture'),
  overlayReady: () => ipcRenderer.invoke('pick:ready'),
  selectPixel: (x, y) => ipcRenderer.invoke('pick:select', { x, y }),
  cancelPick: () => ipcRenderer.invoke('pick:cancel'),
  failPick: message => ipcRenderer.invoke('pick:fail', message),
  copy: (hex, format) => ipcRenderer.invoke('color:copy', { hex, format }),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  removeColor: hex => ipcRenderer.invoke('history:remove', hex),
  windowAction: action => ipcRenderer.invoke('window:action', action),
  getWindowState: () => ipcRenderer.invoke('window:state'),
  onWindowState: callback => {
    const listener = (_: unknown, state: WindowState) => callback(state)
    ipcRenderer.on('window:changed', listener)
    return () => ipcRenderer.removeListener('window:changed', listener)
  },
  onState: callback => {
    const listener = (_: unknown, state: AppState) => callback(state)
    ipcRenderer.on('state:changed', listener)
    return () => ipcRenderer.removeListener('state:changed', listener)
  },
  onError: callback => {
    const listener = (_: unknown, message: string) => callback(message)
    ipcRenderer.on('app:error', listener)
    return () => ipcRenderer.removeListener('app:error', listener)
  }
}
contextBridge.exposeInMainWorld('picker', api)
