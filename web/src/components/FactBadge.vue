<script setup>
import { computed } from 'vue';
import { QUALITY } from '@shared/sources.js';

// Значок рядом со сведением: достоверность и сколько источников. Пустой — только тем, кто правит: «+ источник».
const props = defineProps({ info: Object, editable: Boolean });
defineEmits(['open']);
const q = computed(() => props.info?.quality);
const n = computed(() => props.info?.cites.length || 0);
const text = computed(() => [q.value && QUALITY[q.value].short, n.value && (q.value ? `${n.value} ист.` : n.value === 1 ? 'источник' : `${n.value} источника`)]
  .filter(Boolean).join(' · '));
const label = computed(() => [q.value && QUALITY[q.value].label, n.value && `источников: ${n.value}`].filter(Boolean).join(', '));
</script>

<template>
  <button v-if="text || editable" type="button" class="badge" :class="q || (text ? 'src' : 'empty')"
    :aria-label="text ? `${label}. Подробнее` : 'Указать источник'" @click.prevent.stop="$emit('open')">
    <svg v-if="q === 'document'" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg>
    <svg v-else-if="q === 'oral'" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H7l-3 3zm2 2v8.2L6.2 14H18V6z" /></svg>
    <svg v-else-if="q === 'guess'" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18h2v-2h-2zm1-14a4 4 0 0 0-4 4h2a2 2 0 1 1 2 2c-.6 0-1 .4-1 1v3h2v-2.2A4 4 0 0 0 12 4z" /></svg>
    <svg v-else-if="text" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l5 5v15H6zm8 1.5V8h4.5zM8 12v2h8v-2zm0 4v2h8v-2z" /></svg>
    <span>{{ text || '+ источник' }}</span>
  </button>
</template>

<style scoped>
.badge {
  display: inline-flex; align-items: center; gap: 4px; min-height: 34px; padding: 4px 11px 4px 9px; border-radius: 999px;
  font-size: 13px; font-weight: 600; line-height: 1.2; flex: none; white-space: nowrap;
}
.badge svg { width: 16px; height: 16px; fill: currentColor; flex: none; }
.document { background: var(--accent-soft); color: var(--accent); }
.oral { background: var(--oral-soft); color: var(--oral); }
.guess, .src { background: var(--line); color: var(--text); }
.empty { background: transparent; color: var(--muted); font-weight: 400; border: 1px dashed var(--line); }
</style>
