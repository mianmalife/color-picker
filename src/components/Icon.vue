<script setup lang="ts">
defineProps<{ name: string; size?: number }>()
const paths: Record<string, string[]> = {
  dropper: ['m16 3 5 5-3 3-2-2-8 8-4 1 1-4 8-8-2-2 3-3Z', 'm12 7 5 5'],
  copy: ['M9 9h12v12H9z', 'M15 5V3H3v12h2'],
  history: ['M3 11a9 9 0 1 1 2 7', 'M3 4v7h7', 'M12 7v5l3 2'],
  settings: ['m9 3-.7 2.4-2 .9-2.3-.6-2 3.5 1.7 1.8v2l-1.7 1.8 2 3.5 2.3-.6 2 .9L9 21h4l.7-2.4 2-.9 2.3.6 2-3.5-1.7-1.8v-2L20 9.2l-2-3.5-2.3.6-2-.9L13 3Z', 'M14 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
  arrow: ['M5 12h14', 'm13 6 6 6-6 6'],
  close: ['m6 6 12 12', 'M18 6 6 18'],
  minus: ['M5 12h14'],
  maximize: ['M5 5h14v14H5z'],
  restore: ['M8 8h12v12H8z', 'M16 8V4H4v12h4'],
  fullscreen: ['M8 3H3v5', 'M16 3h5v5', 'M3 16v5h5', 'M21 16v5h-5'],
  shrink: ['M3 8h5V3', 'M21 8h-5V3', 'M8 21v-5H3', 'M16 21v-5h5'],
  check: ['m5 12 4 4L19 6'],
  trash: ['M3 6h18', 'M9 6V3h6v3', 'm6 6 1 15h10l1-15', 'M10 10v7', 'M14 10v7'],
  search: ['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'm15 15 6 6'],
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  keyboard: ['M3 5h18v14H3z', 'M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8'],
  monitor: ['M3 4h18v13H3z', 'M8 21h8', 'M12 17v4']
}
</script>
<template><svg :width="size || 20" :height="size || 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-for="(path, i) in paths[name] || paths.dropper" :key="i" :d="path" /></svg></template>
