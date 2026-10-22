<script setup>
import { computed } from 'vue';
import { QUALITY } from '@shared/sources.js';

// Подпись под сведением: откуда оно известно — «Есть документ», «Со слов», «2 источника».
// Пустая — только тем, кто правит: «Откуда известно?». Нажатие открывает окно сведения.
const props = defineProps({ info: Object, editable: Boolean });
defineEmits(['open']);
const q = computed(() => props.info?.quality);
const n = computed(() => props.info?.cites.length || 0);
const many = (k, one, few, lots) => `${k} ${k % 10 === 1 && k % 100 !== 11 ? one : k % 10 >= 2 && k % 10 <= 4 && (k % 100 < 12 || k % 100 > 14) ? few : lots}`;
const sources = (k) => many(k, 'источник', 'источника', 'источников');
const text = computed(() => {
  if (q.value === 'document') return n.value > 1 ? many(n.value, 'документ', 'документа', 'документов') : 'Есть документ';
  if (q.value) return [QUALITY[q.value].label, n.value && sources(n.value)].filter(Boolean).join(', ');
  if (n.value) return n.value === 1 ? 'Есть источник' : sources(n.value);
  return '';
});
</script>

<template>
  <button v-if="text || editable" type="button" class="badge" :class="q || (text ? 'src' : 'empty')"
    :aria-label="text ? `${text}. Подробнее` : 'Откуда известно? Указать источник'" @click.prevent.stop="$emit('open')">
    <svg v-if="q === 'document'" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg>
    <svg v-else-if="q === 'oral'" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H7l-3 3zm2 2v8.2L6.2 14H18V6z" /></svg>
    <svg v-else-if="q === 'guess'" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18h2v-2h-2zm1-14a4 4 0 0 0-4 4h2a2 2 0 1 1 2 2c-.6 0-1 .4-1 1v3h2v-2.2A4 4 0 0 0 12 4z" /></svg>
    <svg v-else-if="text" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l5 5v15H6zm8 1.5V8h4.5zM8 12v2h8v-2zm0 4v2h8v-2z" /></svg>
    <span>{{ text || 'Откуда известно?' }}</span>
  </button>
</template>

<style scoped>
/* Не кнопка-переключатель, а подпись со значком: без рамки и заливки, слева под значением. */
.badge {
  display: inline-flex; align-items: center; gap: 0.278rem; min-height: 2.444rem; padding: 0.222rem 0; margin: 0;
  background: none; border: 0; border-radius: 0.333rem; font-size: 0.889rem; font-weight: 700; line-height: 1.25; text-align: left;
  justify-content: flex-start; max-width: 100%;
}
.badge span { overflow-wrap: anywhere; }
.badge svg { width: 1.111rem; height: 1.111rem; fill: currentColor; flex: none; }
.document { color: var(--accent-text); }
.oral { color: var(--oral); }
.guess, .src { color: var(--muted); }
.empty { color: var(--accent-text); font-weight: 400; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 4px; }
</style>
