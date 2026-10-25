<script setup>
// Значки разделов (линии, как в нижней панели): name — ключ из ICONS. p — путь, c — круг [cx, cy, r], r — прямоугольник [x, y, w, h, rx].
defineProps({ name: String });
const ICONS = {
  home: [{ p: 'M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-5h4v5' }],
  tree: [{ c: [12, 5, 2.5] }, { c: [6, 17, 2.5] }, { c: [18, 17, 2.5] }, { p: 'M12 7.5V12M6 14.5V12h12v2.5' }],
  people: [{ c: [9, 8, 3.5] }, { p: 'M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.8a3.4 3.4 0 0 1 0 6.4M18.5 14.8c1.6.8 2.6 2.5 3 5.2' }],
  user: [{ c: [12, 8, 4] }, { p: 'M4 21c1-4 4.2-6 8-6s7 2 8 6' }],
  news: [{ r: [4, 3.5, 16, 17, 2.5] }, { p: 'M8 8.5h8M8 12.5h8M8 16.5h5' }],
  place: [{ p: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z' }, { c: [12, 10, 2.3] }],
  mic: [{ r: [9, 3, 6, 11, 3] }, { p: 'M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21' }],
  ask: [{ p: 'M4 5h16v11H9.5L4 20z' }, { p: 'M10 9a2 2 0 1 1 2.8 1.8c-.6.3-.8.7-.8 1.2M12 14v.01' }],
  form: [{ r: [5, 3, 14, 18, 2] }, { p: 'M9 8h6M9 12h6M9 16h4' }],
  check: [{ c: [12, 12, 9] }, { p: 'M8 12.5l3 3 5-6' }],
  search: [{ c: [10.5, 10.5, 6.5] }, { p: 'M15.5 15.5L20 20' }],
  pen: [{ p: 'M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z M14 7.5l2.5 2.5' }],
  history: [{ c: [12, 12, 8.5] }, { p: 'M12 7.5V12l3 2' }],
  upload: [{ p: 'M12 16V4M7 9l5-5 5 5M5 20h14' }],
  download: [{ p: 'M12 4v11M7 10l5 5 5-5M5 20h14' }],
  print: [{ p: 'M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2' }, { r: [7, 14, 10, 7, 1] }],
  archive: [{ r: [3, 4, 18, 4.5, 1] }, { p: 'M5 8.5V20h14V8.5M10 13h4' }],
  invite: [{ c: [9, 8, 3.5] }, { p: 'M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M19 7v6M16 10h6' }],
  server: [{ r: [4, 4, 16, 6, 1.5] }, { r: [4, 14, 16, 6, 1.5] }, { p: 'M8 7h.01M8 17h.01' }],
  help: [{ c: [12, 12, 9] }, { p: 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.4M12 17v.01' }],
};
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-for="(s, i) in ICONS[name] || []" :key="i">
      <path v-if="s.p" :d="s.p" />
      <circle v-else-if="s.c" :cx="s.c[0]" :cy="s.c[1]" :r="s.c[2]" />
      <rect v-else :x="s.r[0]" :y="s.r[1]" :width="s.r[2]" :height="s.r[3]" :rx="s.r[4]" />
    </template>
  </svg>
</template>
