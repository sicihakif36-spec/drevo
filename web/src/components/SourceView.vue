<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { store, canEdit, toast, onLive } from '../store.js';
import { api, photoUrl, thumbUrl } from '../api.js';
import { fullName } from '@shared/names.js';
import { KINDS, docCite, kindNote, pageText, partName, sourceTitle } from '@shared/sources.js';
import { citeWhat } from '../sources.js';
import SourceForm from './SourceForm.vue';
import { ask, askText } from './ask.js';

// Страница источника поверх карточки или документа: документ (название, шифр дела — ссылкой на весь документ), лист и номер
// записи, скан, к каким сведениям каких людей она привязана; правка страницы или документа, удаление.
// person — чей альбом предлагать для скана; без него — альбом первого человека страницы.
const props = defineProps({ id: String, person: Object });
const emit = defineEmits(['close', 'changed']);

const s = ref(null);
const error = ref('');
const mode = ref('view'); // view, page, doc
const busy = ref('');
const formError = ref('');

async function load() {
  try {
    s.value = await api('GET', `/api/sources/${props.id}`);
  } catch (e) {
    if (e.status === 404) emit('close');
    else error.value = e.message;
  }
}
watch(() => props.id, load, { immediate: true });
onUnmounted(onLive((events) => { if (mode.value === 'view' && events.some((e) => e.kind === 'tree')) return load(); }));

// Привязки по людям: «Смирнов Пётр Иванович — дата рождения, место рождения».
const rows = computed(() => (s.value?.citations || []).map((c) => ({
  ...c,
  who: c.persons.map((id) => store.idx?.persons.get(id)).filter(Boolean),
  what: citeWhat(c),
})));
const pdf = computed(() => s.value?.media_kind === 'doc' && !s.value.media_thumb);
const albumOf = computed(() => props.person?.id || s.value?.persons?.[0]);
const part = computed(() => s.value && partName(s.value.kind));

async function save({ doc, page }) {
  busy.value = 'Сохраняю…';
  formError.value = '';
  try {
    if (mode.value === 'doc') await api('PATCH', `/api/documents/${s.value.document_id}`, doc);
    else await api('PATCH', `/api/sources/${s.value.id}`, page);
    await load();
    toast(mode.value === 'doc' ? 'Документ сохранён' : 'Сохранено');
    mode.value = 'view';
    emit('changed');
  } catch (e) {
    formError.value = e.message;
  } finally {
    busy.value = '';
  }
}

async function editPage(c) {
  const page = await askText({ text: 'Уточнение к источнику', label: 'Что ещё уточнить', value: c.page });
  if (page === null) return;
  try {
    await api('PATCH', `/api/citations/${c.id}`, { page });
    await load();
    emit('changed');
  } catch (e) { toast(e.message); }
}

async function detach(c) {
  if (!await ask({ text: `Убрать этот источник у сведения «${c.what}»?`, note: 'Сам источник останется.', yes: 'Убрать', no: 'Не убирать', danger: true })) return;
  try {
    await api('DELETE', `/api/citations/${c.id}`);
    await load();
    emit('changed');
  } catch (e) { toast(e.message); }
}

async function remove() {
  const word = s.value.kind === 'legend' ? 'запись' : 'страницу';
  const what = pageText(s.value) ? `${word} «${pageText(s.value)}»` : word;
  if (!await ask({ text: `Удалить ${what} из документа «${sourceTitle(s.value)}»?`, note: 'Она пропадёт у всех людей. Сам документ и другие его страницы останутся. Вернуть можно в «Главная → Последние правки».', yes: 'Удалить', no: 'Не удалять', danger: true })) return;
  try {
    await api('DELETE', `/api/sources/${s.value.id}`);
    toast('Удалено. Вернуть можно в «Главная → Последние правки».');
    emit('changed');
    emit('close');
  } catch (e) { toast(e.message); }
}
</script>

<template>
  <div class="srcview" role="dialog" aria-modal="true">
    <div class="page">
      <div class="row top">
        <button class="ghost" @click="mode === 'view' ? emit('close') : (mode = 'view')">‹ {{ mode === 'view' ? 'Назад' : 'Отмена' }}</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-else-if="!s" class="muted">Загрузка…</p>

      <template v-else-if="mode === 'page'">
        <h1>{{ part }} документа</h1>
        <SourceForm :source="s" :person-id="albumOf" part :busy="busy" :error="formError" @submit="save" @cancel="mode = 'view'" />
      </template>

      <template v-else-if="mode === 'doc'">
        <h1>{{ KINDS[s.kind]?.label }}</h1>
        <p class="muted small">Название и шифр изменятся у всех страниц этого документа.</p>
        <SourceForm :source="{ ...s, note: s.doc_note }" doc :busy="busy" :error="formError" @submit="save" @cancel="mode = 'view'" />
      </template>

      <template v-else>
        <router-link :to="`/documents/${s.document_id}`" class="doc">
          <span class="grow">
            <span v-if="kindNote(s)" class="muted small">{{ kindNote(s) }}</span>
            <span class="ttl">{{ sourceTitle(s) }}</span>
            <span v-if="docCite(s)" class="small">{{ docCite(s) }}</span>
          </span>
          <span class="muted">›</span>
        </router-link>
        <h1>{{ pageText(s) || part }}</h1>
        <p v-if="s.url"><a :href="s.url" target="_blank" rel="noopener noreferrer" class="link">{{ s.url.replace(/^https?:\/\//, '') }}</a></p>
        <a v-if="s.media_id" :href="photoUrl(s.media_id)" target="_blank" class="scan">
          <span v-if="pdf" class="pdf">PDF</span>
          <img v-else :src="thumbUrl(s.media_id)" alt="Скан" />
          <span>Открыть скан</span>
        </a>
        <div v-if="s.note" class="note">{{ s.note }}</div>
        <div class="muted small">Записано: {{ s.user_name || 'кто-то' }}, {{ new Date(s.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) }}</div>

        <h2>Что подтверждает</h2>
        <div class="list">
          <div v-for="c in rows" :key="c.id" class="cit">
            <div class="grow">
              <router-link v-for="x in c.who" :key="x.id" :to="`/person/${x.id}`" class="who">{{ fullName(x) }}</router-link>
              <div>{{ c.what }}</div>
              <div v-if="c.page" class="muted small">{{ c.page }}</div>
            </div>
            <template v-if="canEdit()">
              <button class="ghost icon" aria-label="Изменить уточнение" @click="editPage(c)">✎</button>
              <button class="danger icon" aria-label="Убрать у этого сведения" @click="detach(c)">✕</button>
            </template>
          </div>
          <div v-if="!rows.length" class="muted">Пока ни к чему не привязана.</div>
        </div>

        <div v-if="canEdit()" class="actions-col">
          <button class="block" @click="formError = ''; mode = 'page'">Изменить {{ s.kind === 'legend' ? 'запись' : 'страницу: лист, номер, скан' }}</button>
          <button class="block" @click="formError = ''; mode = 'doc'">Изменить документ: название, шифр</button>
          <button class="danger block" @click="remove">Удалить {{ s.kind === 'legend' ? 'запись' : 'страницу' }}</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.srcview { position: fixed; inset: 0 0 0 var(--side); z-index: 50; background: var(--bg); overflow-y: auto; overscroll-behavior: contain; }
.srcview .page { padding-bottom: calc(32px + var(--safe-b)); }
.top { margin-bottom: 8px; }
h1 { font-size: 1.333rem; overflow-wrap: anywhere; margin-top: 10px; }
.doc { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 12px; background: var(--accent-soft); color: inherit; text-decoration: none; }
.doc .grow > span { display: block; }
.doc .ttl { font-size: 1rem; font-weight: 600; overflow-wrap: anywhere; }
.link { overflow-wrap: anywhere; font-size: 0.944rem; }
.scan { display: flex; align-items: center; gap: 12px; margin: 12px 0; text-decoration: none; font-size: 0.944rem; }
.scan img, .pdf { width: 84px; height: 84px; object-fit: cover; border-radius: 10px; background: var(--line); display: grid; place-items: center; font-weight: 700; color: var(--muted); }
.note { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.944rem; line-height: 1.5; margin: 12px 0; }
.cit { align-items: center; gap: 4px !important; padding-right: 8px !important; }
.icon { padding: 10px; min-width: 44px; font-size: 1rem; }
.who { display: block; font-weight: 600; text-decoration: none; }
.actions-col { display: flex; flex-direction: column; gap: 8px; margin-top: 22px; }
</style>
