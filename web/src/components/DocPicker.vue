<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { KINDS, docCite, sourceTitle } from '@shared/sources.js';
import { PLURAL } from '../sections.js';

// Выбор записанного документа: метрическая книга, ревизская сказка… Поиск по названию и шифру, недавние — первыми.
// exclude — какие не показывать. Наружу — pick(документ).
const props = defineProps({ exclude: { type: Array, default: () => [] } });
const emit = defineEmits(['pick', 'loaded']);
const all = ref(null);
const query = ref('');

onMounted(async () => {
  all.value = await api('GET', '/api/documents').catch(() => []);
  emit('loaded', all.value.filter((d) => !props.exclude.includes(d.id)).length);
});
const found = computed(() => {
  const words = query.value.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  return (all.value || []).filter((d) => !props.exclude.includes(d.id))
    .filter((d) => words.every((w) => `${sourceTitle(d)} ${docCite(d)}`.toLowerCase().replace(/ё/g, 'е').includes(w)));
});
</script>

<template>
  <input v-if="(all || []).length > 5" v-model="query" type="search" placeholder="Поиск по названию или архиву" class="search" />
  <div v-if="all === null" class="muted">Загрузка…</div>
  <div v-else class="list docs">
    <button v-for="d in found" :key="d.id" type="button" class="pick" @click="emit('pick', d)">
      <span class="grow">
        <span class="ttl">{{ sourceTitle(d) }}</span>
        <span class="muted small">{{ [docCite(d) || (d.title && KINDS[d.kind]?.label), d.pages && PLURAL(d.pages, 'страница', 'страницы', 'страниц')].filter(Boolean).join(' · ') }}</span>
      </span>
      <span class="muted">›</span>
    </button>
    <div v-if="!found.length" class="muted">{{ query ? 'Ничего не нашлось.' : 'Записанных документов пока нет.' }}</div>
  </div>
</template>

<style scoped>
.search { margin-bottom: 8px; }
.pick { justify-content: flex-start; text-align: left; background: transparent; border-radius: 0; width: 100%; }
.pick .grow > span { display: block; }
.ttl { font-size: 0.944rem; font-weight: 600; overflow-wrap: anywhere; }
</style>
