# 拾色 · Color Picker

基于 Electron、Vue 3、TypeScript 和 Vite 的 Windows 桌面取色器。

## 取色标准

定位为 SDR 桌面像素取色器。采集冻结的桌面画面，按照截图声明的颜色空间统一输出为 8 位 sRGB，预览、放大镜、确认、历史和剪贴板共用同一份 RGBA 数据。不会根据浏览器名称或显示器型号补偿颜色，也不反推网页 CSS 或图片文件原色。

例如 CSS `#048BE4` 经应用的显示色彩管理后，桌面采集值可能是 `#378BE0`；本工具保留采集结果。要核对网页 CSS，请使用浏览器元素检查工具。截图没有可靠颜色空间信息时，不能据此保证跨设备色度测量准确。

## 开始开发

环境：Node.js 22.12+（推荐 Node.js 24 LTS）、npm、Windows 10/11。

```powershell
npm install
npm run dev
```

Electron 的 npm 包与二进制运行时是分别安装的。若开发启动提示 Electron 安装不完整，或 `node_modules/electron/dist/` 不存在，可执行以下命令安装对应版本的运行时：

```powershell
npm run electron:install
```

项目通过 `scripts/electron-mirror.cjs` 默认使用国内 npmmirror 下载 Electron 二进制，适用于 `npm run electron:install`、`npm run pack`、`npm run pack:zip` 和 `npm run dist`，无需修改全局 npm 配置。下载地址例如 `https://npmmirror.com/mirrors/electron/44.9.2/electron-v44.9.2-win32-x64.zip`；继续使用 Electron npm 包随附的官方 SHA-256 校验表，优先复用该下载地址的有效缓存。更换下载源时首次可能需要重新下载一次，后续复用缓存。

需要其他下载源时，可在当前 PowerShell 会话覆盖环境变量：

```powershell
$env:ELECTRON_MIRROR = "https://github.com/electron/electron/releases/download/"
$env:ELECTRON_CUSTOM_DIR = "v{{ version }}"
npm run pack
```

清除这两个变量后恢复项目默认镜像。已有的 npm Electron 镜像环境变量仍按下载器的优先级生效。代理环境下可为该次命令设置 `$env:ELECTRON_GET_USE_PROXY = "1"`；已配置的 `HTTP_PROXY` / `HTTPS_PROXY` 由下载器使用。

TypeScript 固定为 6.0.3，以兼容当前 Vue 类型检查工具；`@electron/get` 统一使用 5.x，避免旧下载器的过时依赖。升级工具链时请重新运行类型检查和桌面测试。

## 当前功能

- 点击「开始取色」，或使用默认全局快捷键 `Ctrl + Alt + C`。
- 标题栏支持全屏、最大化/还原；`F11` 切换全屏，主窗口内 `Esc` 退出全屏。
- 从全屏窗口取色时，等待窗口退出全屏并隐藏再截图；完成或取消后恢复原来的全屏状态。
- 冻结各显示器画面，以原始分辨率读取像素；放大镜支持滚轮切换 6×、18×、66×，默认 18×。
- 方向键每次移动 1 个截图物理像素，Shift＋方向键每次移动 10 像素；显示取样坐标与微调光标，移动鼠标恢复鼠标取样。
- 左键或 `Enter` 确认并自动复制，`Esc` 或右键取消。
- HEX、RGB、HSL 查看与复制，支持手动输入 HEX 预览。
- 最近 80 个颜色按最近使用排序、去重；搜索、移除、清空历史。
- 自定义快捷键、默认复制格式，快捷键占用时显示提示。
- 自定义复制模板、大小写与无 # HEX、RGB/HSL、CSS 声明预设、即时预览与输入校验。
- 关闭窗口收起到系统托盘，右键托盘图标可取色、打开、退出。
- 颜色与设置保存在 Electron `userData` 下的 `colors.json`；截图只在取色期间驻留内存，不上传、不保存到磁盘。

## 开发与验证

```powershell
npm test             # 色值换算、坐标映射测试
npm run typecheck    # TypeScript / Vue 类型检查
npm run build        # 类型检查 + 生产构建
npm run start        # 运行构建结果
npm run test:smoke   # Electron 真实窗口/截图/IPC/剪贴板/持久化测试
npm run test:controls # 缩放、键盘微调、复制模板与设置迁移测试
npm run test:desktop # Windows GetPixel 与画布/预览/确认/剪贴板对照
node scripts/window-controls.mjs # 全屏悬停、退出、最大化/还原回归
```

`npm run start` 和直接运行窗口回归脚本前，需先完成 `npm run build`。

烟雾测试会临时打开取色窗口、写入并恢复剪贴板文本，使用独立临时用户数据目录；运行前请退出其他本项目实例。测试报告和窗口截图写入 `artifacts/`。

锁屏回归通过向测试进程注入系统事件验证首次启动、截图准备阶段及活动浮层的行为；测试不会执行系统锁屏命令。报告会记录实际显示器数量与缩放比例，多屏硬件覆盖范围以记录为准。

0.2.0 已通过 11 项单元测试、23 项原有集成检查、9 项缩放/键盘/模板检查，以及八组 Windows 原生像素对照。成品另验证取色一致性、模板预览、缩放微调与三轮全屏悬停。实机环境为 1920×1080、100% 缩放的单显示器；125%/150% 坐标换算有单元测试，混合 DPI 多屏仍待对应设备验证。

## 按需打包

在项目根目录执行。首次准备项目时先运行 `npm ci` 安装锁定版本的依赖；重新打包前退出正在运行的本项目应用，包括系统托盘中的实例。

生成可直接运行的完整应用目录：

```powershell
npm run pack
```

此命令自动完成类型检查、生产构建与 Electron 打包，输出 `release/win-unpacked/`。构建器按依赖中的 Electron 版本使用全局缓存，缺少缓存时默认从国内 npmmirror 下载，不依赖 `node_modules/electron/dist/`，也不需要手动设置 `electronDist`。`electron-builder.config.cjs` 调用 Electron 官方下载器，并使用当前 Electron npm 包随附的 SHA-256 校验表校验运行时；命中有效缓存时不必额外联网下载校验表，仍然保留完整的哈希校验。

从 `release/win-unpacked/` 运行 `Color Picker.exe`；运行或分发时必须保留整个目录，不能只复制 EXE。

生成便于分发的 ZIP 压缩包：

```powershell
npm run pack:zip
```

此命令先执行 `npm run pack`，再通过 Windows PowerShell 调用系统自带的 .NET ZIP 压缩功能，无需额外安装或下载压缩工具。ZIP 保存在当前项目目录内的 `release/` 中，例如 0.2.0 的默认 x64 构建输出为 `release/Color Picker-0.2.0-win.zip`，不会写入项目外的交付目录。解压到单独文件夹后运行其中的 `Color Picker.exe`，无需安装；请保留全部解压文件。ZIP 文件名随应用版本变化，重复打包同一版本会覆盖对应文件。

生成 Windows NSIS 安装程序：

```powershell
npm run dist
```

安装程序输出到 `release/`。首次执行可能需要联网下载构建工具。当前配置未进行代码签名。

打包后可执行成品验证：

```powershell
node scripts/verify-package.mjs
node scripts/window-controls.mjs --packaged
```

`out/` 为编译输出，`release/` 为打包输出，`artifacts/` 为测试截图和报告。这些目录均已忽略，可清理并按需重新生成；项目保留源码、测试、构建配置、应用图标及依赖锁文件。运行环境不依赖开发过程的审查记录、临时副本或下载探测脚本。

## 自定义复制模板

在偏好设置中将默认复制格式选为「自定义复制模板」。占位符支持 `{hex}`、`{hexLower}`、`{hexNoHash}`、`{hexLowerNoHash}`、`{r}` / `{g}` / `{b}`、`{h}` / `{s}` / `{l}`、`{rgb}` 和 `{hsl}`。模板可包含换行，最多 512 个字符；字面花括号写成 `{{` 和 `}}`。

例如 `color: {hexLower};` 会复制为 `color: #048be4;`；`.swatch {{ color: {hex}; }}` 会复制为 `.swatch { color: #048BE4; }`。模板是纯文本替换，不执行脚本。主面板的 HEX/RGB/HSL 按钮仍按各自格式复制，自动取色、历史复制和「自定义复制」按钮使用保存的默认格式。

旧版设置自动补充模板默认值，保留已有快捷键与历史。无效模板不能保存；磁盘中损坏的自定义模板会回退到 HEX。

## 源码目录

```text
electron/main.ts         窗口、截图、托盘、快捷键、存储、IPC 校验
electron-builder.config.cjs  打包运行时下载、缓存与 SHA-256 校验
electron/preload.ts      contextBridge 白名单接口
src/App.vue              主界面与设置
src/components/PickerOverlay.vue  截图取色浮层
src/lib/color.ts         色值转换与像素坐标映射
src/lib/capture.ts       冻结帧通道规范化与共享像素读取
scripts/electron-mirror.cjs  Electron 国内镜像默认配置
scripts/smoke.mjs        Electron 集成验证
scripts/picker-controls.mjs  缩放、微调、复制模板集成验证
tests/                  像素、颜色、坐标、倍率与模板单元测试
```

主窗口使用 DIP 坐标，截图使用实际返回的像素尺寸，取色以浮层内鼠标位置与截图尺寸映射。校验允许 DIP 分数缩放造成的少量整数舍入差异，不对原图重新缩放；明显降采样的截图仍报错。显示器增减、尺寸/旋转/缩放变化会取消当前会话，工作区变化不会误取消。加载失败立即恢复主窗口。

当前针对 Windows SDR 桌面。HDR、受保护视频、系统安全桌面和特殊显卡/远程桌面环境需要另外实机验证；屏幕取色结果也不等同于图片文件的原始色值或专业色彩管理测量结果。

`desktop-pixels.mjs` 使用独立临时用户数据和八个色块，通过 Windows GDI `GetPixel` 读取实际桌面值，再核对本工具的各个环节。色块 CSS 仅作为输入记录，允许应用在显示过程中转换颜色；断言目标是 Windows 实际像素。测试不会调整系统、浏览器或 ICC 配置。

代码采用 MIT 许可证。

