// Project defaults for Electron binaries; callers can override both variables.
process.env.ELECTRON_MIRROR ||= 'https://npmmirror.com/mirrors/electron/'
process.env.ELECTRON_CUSTOM_DIR ||= '{{ version }}'
