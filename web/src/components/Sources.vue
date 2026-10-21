<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { canEdit } from '../store.js';
import { citeText, kindNote, sourceTitle } from '@shared/sources.js';
import { citeWhat } from '../sources.js';
import SourceView from './SourceView.vue';

// Раздел «Источники» в карточке: на что опираются сведения человека, его браков и событий его жизни.
// Открытый источник — поверх карточки, адрес ?source=<id>: кнопка «Назад» на телефоне его закрывает.
const props = defineProps({ person: Object, data: Object });
const emit = defineEmits(['cite', 'changed']);
const route = useRoute();
const router = useRouter();

// Каждый источник — с перечнем сведений, которые он подтверждает: «дата рождения, место рождения».
const items = computed(() => (props.data?.sources || []).map((s) => ({
  ...s,
  facts: [...new Set(props.data.citations.filter((c) => c.source_id === s.id)
    .map(citeWhat))].join(', '),
})));

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
    <button v-for="s in items" :key="s.id" class="item" @click="show(s.id)">
      <span class="grow">
        <span class="title">{{ sourceTitle(s) }}</span>
        <span v-if="citeText(s)" class="small">{{ citeText(s) }}</span>
        <span class="muted small">{{ [kindNote(s), s.facts].filter(Boolean).join(' · ') }}</span>
      </span>
      <span class="muted">›</span>
    </button>
    <div v-if="data && !items.length" class="muted">
      {{ canEdit() ? 'Откуда известны даты и места? Укажите метрическую книгу, архивный документ или семейное предание.' : 'Источники не указаны.' }}
    </div>
    <div v-if="data && canEdit()"><button class="primary block" @click="emit('cite')">+ Указать источник</button></div>
  </div>

  <SourceView v-if="route.query.source" :key="route.query.source" :id="route.query.source" :person="person"
    @close="close" @changed="emit('changed')" />
</template>

<style scoped>
.sources > .item { justify-content: flex-start; text-align: left; background: transparent; border-radius: 0; width: 100%; }
.item .title { display: block; font-size: 0.944rem; font-weight: 600; overflow-wrap: anywhere; }
.item .grow > span { display: block; }
</style>
