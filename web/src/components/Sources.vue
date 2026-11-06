<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { canEdit } from '../store.js';
import { docCite, kindNote, pageText, sourceTitle } from '@shared/sources.js';
import { citeWhat } from '../sources.js';
import SourceView from './SourceView.vue';

// Раздел «Источники» в карточке: на что опираются сведения человека, его браков и событий его жизни.
// Открытый источник — поверх карточки, адрес ?source=<id>: кнопка «Назад» на телефоне его закрывает.
const props = defineProps({ person: Object, data: Object });
const emit = defineEmits(['cite', 'changed']);
const route = useRoute();
const router = useRouter();

// Источники по документам: метрическая книга — один раз, под ней её страницы с тем, что каждая подтверждает:
// «л. 34 об., запись № 57 — дата рождения, место рождения».
const items = computed(() => {
  const docs = new Map();
  for (const s of props.data?.sources || []) {
    if (!docs.has(s.document_id)) docs.set(s.document_id, { ...s, id: s.document_id, pages: [] });
    docs.get(s.document_id).pages.push({
      ...s,
      facts: [...new Set(props.data.citations.filter((c) => c.source_id === s.id).map(citeWhat))].join(', '),
    });
  }
  return [...docs.values()];
});

function show(id) {
  router.push({ query: { ...route.query, source: id } });
}
// Источник открыли из этой карточки — закрываем шагом назад, чтобы «Назад» не открывал его снова; по ссылке — убираем из адреса.
function close() {
  const { source, ...rest } = route.query;
  if (!source) return;
  if (window.history.state?.back === router.resolve({ query: rest }).fullPath) router.back();
  else router.replace({ query: rest });
}
</script>

<template>
  <h2>Источники</h2>
  <div v-if="person.hidden" class="card muted small">Источники сведений о живых родственниках видны только участникам дерева.</div>
  <div v-else class="list sources">
    <div v-if="!data" class="muted">Загрузка…</div>
    <div v-for="d in items" :key="d.id" class="doc">
      <div class="head">
        <span class="title">{{ sourceTitle(d) }}</span>
        <span v-if="docCite(d) || kindNote(d)" class="muted small">{{ [kindNote(d), docCite(d)].filter(Boolean).join(' · ') }}</span>
      </div>
      <button v-for="s in d.pages" :key="s.id" class="item" @click="show(s.id)">
        <span class="grow">
          <span v-if="pageText(s)" class="small pgt">{{ pageText(s) }}</span>
          <span class="muted small">{{ s.facts || 'ни к чему не привязан' }}</span>
        </span>
        <span class="muted">›</span>
      </button>
    </div>
    <div v-if="data && !items.length" class="muted">
      {{ canEdit() ? 'Откуда известны даты и места? Укажите метрическую книгу, архивный документ или семейное предание.' : 'Источники не указаны.' }}
    </div>
    <div v-if="data && canEdit()"><button class="primary block" @click="emit('cite')">+ Указать источник</button></div>
  </div>

  <SourceView v-if="route.query.source" :key="route.query.source" :id="route.query.source" :person="person"
    @close="close" @changed="emit('changed')" />
</template>

<style scoped>
.doc { padding: 10px 0 2px !important; display: block !important; }
.doc .head { padding: 0 14px 4px; }
.doc .head > span { display: block; }
.doc .title { font-size: 0.944rem; font-weight: 600; overflow-wrap: anywhere; }
.doc .item { display: flex; align-items: center; justify-content: flex-start; gap: 8px; text-align: left; background: transparent; border: 0;
  border-top: 1px solid var(--line); border-radius: 0; width: 100%; min-height: 44px; padding: 8px 14px 8px 26px; color: inherit; font-weight: 400; }
.item .grow { display: flex; flex-direction: column; gap: 2px; }
.item .pgt { font-weight: 600; }
</style>
