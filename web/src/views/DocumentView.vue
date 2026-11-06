<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store, canEdit, toast, onLive } from '../store.js';
import { api } from '../api.js';
import { fullName } from '@shared/names.js';
import { KINDS, docCite, kindNote, pageText, partName, sourceTitle } from '@shared/sources.js';
import { citeWhat } from '../sources.js';
import { PLURAL } from '../sections.js';
import SourceForm from '../components/SourceForm.vue';
import SourceView from '../components/SourceView.vue';
import DocPicker from '../components/DocPicker.vue';
import { ask } from '../components/ask.js';

// Документ: название и шифр дела, все его страницы — у кого какая и что подтверждает. Правка — у всех страниц сразу;
// двойник (тот же документ, записанный дважды) объединяется. Страница открывается поверх, адрес ?source=<id>.
const props = defineProps({ id: String });
const route = useRoute();
const router = useRouter();
const d = ref(null);
const error = ref('');
const mode = ref('view'); // view, edit, merge
const busy = ref('');
const formError = ref('');

async function load() {
  try {
    d.value = await api('GET', `/api/documents/${props.id}`);
  } catch (e) {
    error.value = e.status === 404 ? 'Документ не найден: его удалили или объединили с другим.' : e.message;
  }
}
watch(() => props.id, load, { immediate: true });
onUnmounted(onLive((events) => { if (mode.value === 'view' && events.some((e) => e.kind === 'tree')) return load(); }));

const part = computed(() => d.value && partName(d.value.kind));
// Страницы с людьми: «л. 34 об., запись № 57 — Калинин Иван Петрович: дата рождения».
// Сведения одних и тех же людей — одной строкой: «… — дата рождения, место рождения».
const pages = computed(() => (d.value?.pages || []).map((p) => {
  const rows = new Map();
  for (const c of d.value.citations.filter((x) => x.source_id === p.id)) {
    const who = c.persons.map((id) => store.idx?.persons.get(id)).filter(Boolean).map((x) => fullName(x)).join(', ');
    rows.set(who, [...(rows.get(who) || []), citeWhat(c)]);
  }
  return { ...p, rows: [...rows].map(([who, what]) => ({ who, what: [...new Set(what)].join(', ') })) };
}));

async function save({ doc }) {
  busy.value = 'Сохраняю…';
  formError.value = '';
  try {
    await api('PATCH', `/api/documents/${d.value.id}`, doc);
    await load();
    mode.value = 'view';
    toast('Документ сохранён');
  } catch (e) {
    formError.value = e.message;
  } finally {
    busy.value = '';
  }
}

async function merge(other) {
  if (!await ask({
    text: `«${sourceTitle(other)}» — это тот же документ?`,
    note: `Его ${PLURAL(other.pages, 'страница перейдёт', 'страницы перейдут', 'страниц перейдут')} сюда, к «${sourceTitle(d.value)}», а он сам исчезнет. Отменить можно в «Главная → Последние правки».`,
    yes: 'Объединить', no: 'Не объединять',
  })) return;
  try {
    await api('POST', `/api/documents/${d.value.id}/merge`, { from: other.id });
    toast('Документы объединены');
    mode.value = 'view';
    await load();
  } catch (e) { toast(e.message); }
}

async function remove() {
  const n = d.value.pages.length;
  if (!await ask({
    text: `Удалить документ «${sourceTitle(d.value)}»?`,
    note: `${n ? `Вместе с ним удалятся ${PLURAL(n, 'страница', 'страницы', 'страниц')} у всех людей. ` : ''}Вернуть можно в «Главная → Последние правки».`,
    yes: 'Удалить', no: 'Не удалять', danger: true,
  })) return;
  try {
    await api('DELETE', `/api/documents/${d.value.id}`);
    toast('Документ удалён. Вернуть можно в «Главная → Последние правки».');
    router.back();
  } catch (e) { toast(e.message); }
}

function show(id) {
  router.push({ query: { ...route.query, source: id } });
}
function close() {
  const { source, ...rest } = route.query;
  if (!source) return;
  if (window.history.state?.back === router.resolve({ query: rest }).fullPath) router.back();
  else router.replace({ query: rest });
}
</script>

<template>
  <div class="page">
    <div class="row" style="margin-bottom:8px">
      <button class="ghost" aria-label="Назад" @click="mode === 'view' ? router.back() : (mode = 'view')">‹ {{ mode === 'view' ? 'Назад' : 'Отмена' }}</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!d" class="muted">Загрузка…</p>

    <template v-else-if="mode === 'edit'">
      <h1>{{ KINDS[d.kind]?.label }}</h1>
      <p class="muted small">Название и шифр изменятся у всех страниц этого документа.</p>
      <SourceForm :source="d" doc :busy="busy" :error="formError" @submit="save" @cancel="mode = 'view'" />
    </template>

    <template v-else-if="mode === 'merge'">
      <h1>Объединить</h1>
      <p class="muted">Этот же документ записан ещё раз под другим названием? Выберите его — его страницы перейдут сюда.</p>
      <DocPicker :exclude="[d.id]" @pick="merge" />
    </template>

    <template v-else>
      <div class="muted small">{{ kindNote(d) || KINDS[d.kind]?.label }}</div>
      <h1>{{ sourceTitle(d) }}</h1>
      <p v-if="docCite(d)" class="cite">{{ docCite(d) }}</p>
      <div v-if="d.note" class="note">{{ d.note }}</div>

      <h2>{{ d.kind === 'legend' ? 'Записи' : 'Страницы' }}</h2>
      <div class="list">
        <button v-for="p in pages" :key="p.id" class="pg" @click="show(p.id)">
          <span class="grow">
            <span class="ttl">{{ pageText(p) || part }}</span>
            <span v-for="(r, i) in p.rows" :key="i" class="small"><b v-if="r.who">{{ r.who }}</b>{{ r.who ? ' — ' : '' }}{{ r.what }}</span>
            <span v-if="!p.rows.length" class="muted small">ни к чему не привязана</span>
          </span>
          <span v-if="p.media_id" class="muted small">скан</span>
          <span class="muted">›</span>
        </button>
        <div v-if="!pages.length" class="muted">Страниц пока нет. Их добавляют в карточке человека: «Источники → Указать источник».</div>
      </div>

      <div v-if="canEdit()" class="actions-col">
        <button class="block" @click="formError = ''; mode = 'edit'">Изменить документ: название, шифр</button>
        <button class="block" @click="mode = 'merge'">Объединить с таким же документом</button>
        <button class="danger block" @click="remove">Удалить документ</button>
      </div>
    </template>

    <SourceView v-if="route.query.source" :key="route.query.source" :id="route.query.source" @close="close" @changed="load" />
  </div>
</template>

<style scoped>
h1 { font-size: 1.333rem; overflow-wrap: anywhere; margin-top: 2px; }
.cite { font-size: 1rem; padding: 10px 14px; border-radius: 12px; background: var(--accent-soft); }
.note { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.944rem; line-height: 1.5; margin: 12px 0; }
.pg .grow > span { display: block; }
.pg .ttl { font-weight: 600; }
.actions-col { display: flex; flex-direction: column; gap: 8px; margin-top: 22px; }
</style>
