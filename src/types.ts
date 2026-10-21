export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'custom'
export interface ColorEntry { hex: string; pickedAt: string }
export interface Settings { shortcut: string; format: ColorFormat; customTemplate: string }
export interface AppState { history: ColorEntry[]; settings: Settings; shortcutAvailable: boolean }
export interface WindowState { maximized: boolean; fullscreen: boolean }
export type WindowAction = 'minimize' | 'close' | 'toggle-maximize' | 'toggle-fullscreen' | 'exit-fullscreen'
export interface Capture { pixels: Uint8Array; colorSpace: 'srgb'; pixelFormat: 'rgba8'; width: number; height: number; cursor: { x: number; y: number }; sessionId: string }
export interface PickerApi {
  getState(): Promise<AppState>
  startPick(): Promise<void>
  getCapture(): Promise<Capture>
  overlayReady(): Promise<void>
  selectPixel(x: number, y: number): Promise<void>
  cancelPick(): Promise<void>
  failPick(message: string): Promise<void>
  copy(hex: string, format: ColorFormat): Promise<void>
  saveSettings(settings: Settings): Promise<AppState>
  clearHistory(): Promise<AppState>
  removeColor(hex: string): Promise<AppState>
  windowAction(action: WindowAction): Promise<void>
  getWindowState(): Promise<WindowState>
  onWindowState(callback: (state: WindowState) => void): () => void
  onState(callback: (state: AppState) => void): () => void
  onError(callback: (message: string) => void): () => void
}
declare global { interface Window { picker: PickerApi } }
