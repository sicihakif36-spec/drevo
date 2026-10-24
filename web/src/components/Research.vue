<script setup>
import { nextTick, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { onLive, toast } from '../store.js';
import { api } from '../api.js';
import { STATUSES, RESULTS, QUESTION_MAX } from '@shared/research.js';
import { fullName } from '@shared/names.js';
import { ask, askText } from './ask.js';
import ResearchPrompt from './ResearchPrompt.vue';

// Исследование в карточке (только владелец и участники): вопросы поиска — «что хотим узнать» — и записи по ходу:
// где искали, что нашли. «Подготовить запрос» — текст для ИИ-помощника, «Загрузить результат» — его ответ в дерево.
// ?q=<id> в адресе — раскрыть этот вопрос (переход из «Ещё → Исследование»).
const props = defineProps({ person: Object });
const emit = defineEmits(['count']); // сколько вопросов «ищем» — для закладки
const route = useRoute();
const router = useRouter();
const items = ref([]);
const loaded = ref(false);
const error = ref('');
const open = reactive(new Set());
const form = ref(null); // запись поиска: { question, note?, result, place, url, ref, body }
const saving = ref(false);
const prompt = ref(null); // вопрос, для которого готовим запрос

const UNDO = 'Вернуть можно в «Ещё → Последние правки».';
// «24 октября», в прошлые годы — «24 октября 2025».
const when = (t) => {
  const d = new Date(t);
  const year = d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year }).replace(/\s*г\.$/, '');
};
const count = (n, one, few, many) => {
  const a = n % 10;
  const b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}`;
};

async function reload() {
  try {
    items.value = await api('GET', `/api/persons/${props.person.id}/research`);
    loaded.value = true;
    error.value = '';
  } catch (e) {
    error.value = e.message;
  }
}
async function load() {
  loaded.value = false;
  items.value = [];
  open.clear();
  await reload();
  const id = route.query.q;
  if (id && items.value.some((x) => x.id === id)) {
    open.add(id);
    await nextTick();
    document.getElementById(`rq-${id}`)?.scrollIntoView({ block: 'start' });
  }
}
watch(() => props.person.id, load, { immediate: true });
watch([loaded, () => items.value.filter((x) => x.status === 'open').length], ([l, n]) => emit('count', l ? n : null), { immediate: true });
onUnmounted(onLive((events) => { if (loaded.value && events.some((e) => e.kind === 'tree')) return reload(); }));

const toggle = (id) => (open.has(id) ? open.delete(id) : open.add(id));

async function addQuestion() {
  const title = (await askText({
    text: 'Что хотите узнать?',
    note: `${fullName(props.person)}. Например: родители, где погиб в 1943, где похоронен.`,
    value: '', yes: 'Добавить вопрос',
  }))?.trim();
  if (!title) return;
  try {
    const x = await api('POST', `/api/persons/${props.person.id}/research`, { title: title.slice(0, QUESTION_MAX) });
    await reload();
    open.add(x.id);
    toast('Вопрос добавлен');
  } catch (e) { toast(e.message); }
}

async function rename(x) {
  const title = (await askText({ text: 'Что хотите узнать?', value: x.title }))?.trim();
  if (!title || title === x.title) return;
  try {
    await api('PATCH', `/api/research/${x.id}`, { title });
    await reload();
  } catch (e) { toast(e.message); }
}

async function setStatus(x, status) {
  if (x.status === status) return;
  try {
    await api('PATCH', `/api/research/${x.id}`, { status });
    await reload();
  } catch (e) { toast(e.message); }
}

async function removeQuestion(x) {
  const ok = await ask({ text: 'Удалить этот вопрос?', note: `«${x.title}» и все записи поиска к нему. ${UNDO}`, yes: 'Удалить', no: 'Не удалять', danger: true });
  if (!ok) return;
  try {
    await api('DELETE', `/api/research/${x.id}`);
    await reload();
    toast(`Удалено. ${UNDO}`);
  } catch (e) { toast(e.message); }
}

function newNote(x) {
  form.value = { question: x, note: null, result: '', place: '', url: '', ref: '', body: '', error: '' };
}
function editNote(x, n) {
  form.value = { question: x, note: n, result: n.result, place: n.place, url: n.url, ref: n.ref, body: n.body, error: '' };
}
async function saveNote() {
  const f = form.value;
  const data = { result: f.result, place: f.place, url: f.url, ref: f.ref, body: f.body };
  saving.value = true;
  f.error = '';
  try {
    if (f.note) await api('PATCH', `/api/research/notes/${f.note.id}`, data);
    else await api('POST', `/api/research/${f.question.id}/notes`, data);
    form.value = null;
    await reload();
    toast('Записано');
  } catch (e) {
    f.error = e.message;
  } finally {
    saving.value = false;
  }
}
async function removeNote(n) {
  const ok = await ask({ text: 'Удалить эту запись?', note: [n.place, n.body.slice(0, 120)].filter(Boolean).join(' — ') + `. ${UNDO}`, yes: 'Удалить', no: 'Не удалять', danger: true });
  if (!ok) return;
  try {
    await api('DELETE', `/api/research/notes/${n.id}`);
    form.value = null;
    await reload();
    toast(`Удалено. ${UNDO}`);
  } catch (e) { toast(e.message); }
}

const upload = (x) => router.push({ path: '/import', query: { q: x.id } });
// Длинный отчёт помощника — свёрнут.
const full = reactive(new Set());
const LONG = 400;
const short = (n) => (n.body.length > LONG && !full.has(n.id) ? `${n.body.slice(0, LONG).trimEnd()}…` : n.body);
const link = (url) => (/^https?:\/\//i.test(url) ? url : '');
</script>

<template>
  <h2>Исследование</h2>
  <p class="muted small intro">Что ищем в архивах и на сайтах, где уже искали и что нашли.
    Видят только владелец и участники — чтобы двое не искали одно и то же.</p>
  <div v-if="error" class="error">{{ error }}</div>
  <div v-else-if="!loaded" class="muted">Загрузка…</div>
  <template v-else>
    <div v-for="x in items" :id="`rq-${x.id}`" :key="x.id" class="card q" :class="x.status">
      <button class="qhead" :aria-expanded="open.has(x.id)" @click="toggle(x.id)">
        <span class="tag" :class="x.status">{{ STATUSES[x.status].label }}</span>
        <span class="grow">
          <span class="title">{{ x.title }}</span>
          <span class="muted small">{{ x.user_name || 'Кто-то' }} · {{ when(x.created_at) }}{{ x.notes ? ` · ${count(x.notes, 'запись', 'записи', 'записей')}` : '' }}</span>
        </span>
        <span class="muted" aria-hidden="true">{{ open.has(x.id) ? '▴' : '▾' }}</span>
      </button>

      <div v-if="open.has(x.id)" class="qbody">
        <div class="seg status" role="group" aria-label="Состояние вопроса">
          <button v-for="(s, k) in STATUSES" :key="k" :class="{ on: x.status === k }" @click="setStatus(x, k)">{{ s.label }}</button>
        </div>

        <div class="notes">
          <div v-for="n in x.items" :key="n.id" class="note">
            <div class="row nhead">
              <span v-if="n.result" class="tag" :class="n.result">{{ RESULTS[n.result].label }}</span>
              <span class="muted small grow">{{ n.user_name || 'Кто-то' }} · {{ when(n.created_at) }}</span>
              <button class="ghost small edit" @click="editNote(x, n)">Изменить</button>
            </div>
            <b v-if="n.place" class="place">{{ n.place }}</b>
            <div v-if="n.ref" class="small">Шифр: {{ n.ref }}</div>
            <div v-if="n.url" class="small url"><a v-if="link(n.url)" :href="n.url" target="_blank" rel="noopener noreferrer">{{ n.url }}</a><span v-else>{{ n.url }}</span></div>
            <div v-if="n.body" class="pre">{{ short(n) }}</div>
            <button v-if="n.body.length > LONG" class="ghost more" @click="full.has(n.id) ? full.delete(n.id) : full.add(n.id)">{{ full.has(n.id) ? 'Свернуть' : 'Показать целиком' }}</button>
            <div v-if="n.op" class="small">
              <router-link :to="{ path: '/changes', query: { op: n.op } }">Что загружено — в «Последних правках»</router-link>
              <span v-if="n.undone" class="muted"> · загрузка отменена</span>
            </div>
          </div>
          <div v-if="!x.items.length" class="muted small empty">Записей пока нет. Запишите, где уже искали, — даже если ничего не нашли.</div>
        </div>

        <button class="primary block" @click="newNote(x)">+ Запись: где искали, что нашли</button>
        <div class="grid2 ai">
          <button @click="prompt = x">Подготовить запрос</button>
          <button @click="upload(x)">Загрузить результат</button>
        </div>
        <p class="muted small hint">Запрос — текст для ИИ-помощника со всем, что известно о {{ person.sex === 'F' ? 'ней' : 'нём' }} и родных.
          Ответ помощника вставьте в «Загрузить результат»: найденные люди попадут в дерево после проверки.</p>
        <div class="grid2">
          <button class="ghost" @click="rename(x)">Изменить вопрос</button>
          <button class="ghost danger" @click="removeQuestion(x)">Удалить вопрос</button>
        </div>
      </div>
    </div>
    <div v-if="!items.length" class="card muted small">Вопросов пока нет. Например: «родители», «где погиб в 1943», «где похоронен».</div>
    <button class="block add" :class="{ primary: !items.length }" @click="addQuestion">+ Новый вопрос</button>
  </template>

  <template v-if="form">
    <div class="sheet-backdrop" @click="form = null" />
    <form class="sheet" role="dialog" aria-modal="true" aria-labelledby="note-title" @submit.prevent="saveNote">
      <h2 id="note-title" style="margin-top:0">{{ form.note ? 'Запись поиска' : 'Новая запись поиска' }}</h2>
      <p class="muted small" style="margin-top:0">К вопросу «{{ form.question.title }}»</p>
      <div class="seg">
        <button v-for="(r, k) in RESULTS" :key="k" type="button" :class="{ on: form.result === k }" @click="form.result = k">{{ r.label }}</button>
      </div>
      <label class="field"><span>Где искали</span><input v-model="form.place" placeholder="например: ОБД «Мемориал», Главархив РТ" /></label>
      <label class="field"><span>Ссылка</span><input v-model="form.url" inputmode="url" placeholder="https://…" /></label>
      <label class="field"><span>Шифр дела</span><input v-model="form.ref" placeholder="например: ф. 4, оп. 1, д. 2, л. 3 об." /></label>
      <label class="field"><span>{{ form.result === 'notfound' ? 'Что искали и не нашли' : 'Что нашли' }}</span>
        <textarea v-model="form.body" rows="5" placeholder="например: запись о рождении, отец — Фёдор, мать — Анастасия" /></label>
      <p v-if="form.error" class="error">{{ form.error }}</p>
      <div class="row">
        <button type="button" class="grow" @click="form = null">Отмена</button>
        <button class="primary grow" :disabled="saving">{{ saving ? 'Сохраняю…' : 'Сохранить' }}</button>
      </div>
      <button v-if="form.note" type="button" class="ghost danger block" style="margin-top:0.444rem" @click="removeNote(form.note)">Удалить запись</button>
    </form>
  </template>

  <ResearchPrompt v-if="prompt" :person="person" :question="prompt" @close="prompt = null" @upload="upload(prompt)" />
</template>

<style scoped>
.intro { margin-top: -0.222rem; }
.q { padding: 0; margin-bottom: 0.556rem; overflow: hidden; }
.q.open { box-shadow: inset 4px 0 var(--oral); }
.qbody { padding: 0 1rem 0.889rem; }
.qhead { display: flex; width: 100%; gap: 0.667rem; align-items: flex-start; border: 0; border-radius: 0; background: transparent; color: inherit;
  font-weight: 400; text-align: left; justify-content: flex-start; padding: 0.778rem 1rem; min-height: 3.333rem; }
.qhead .title { display: block; font-weight: 700; font-size: 1.056rem; overflow-wrap: anywhere; }
.qhead .grow > span { display: block; }
.tag { flex: none; font-size: 0.833rem; font-weight: 700; padding: 0.111rem 0.556rem; border-radius: 999px; background: var(--warn-bg); color: var(--warn-text); margin-top: 0.111rem; }
.tag.found { background: var(--accent-soft); color: var(--accent-text); }
.tag.notfound { background: var(--line); color: var(--muted); }
.status { margin-bottom: 0.667rem; }
.notes { border-top: 1px solid var(--line); margin-bottom: 0.667rem; }
.note { padding: 0.667rem 0; border-bottom: 1px solid var(--line); display: grid; gap: 0.222rem; }
.nhead { min-height: 2.444rem; }
.nhead .tag { margin-top: 0; }
.place { overflow-wrap: anywhere; }
.url { overflow-wrap: anywhere; }
.pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.more { justify-self: start; padding: 0; min-height: 2.222rem; color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; }
.empty { padding: 0.667rem 0; }
.ai { margin-top: 0.5rem; }
.hint { margin: 0.444rem 0 0.222rem; }
.edit { flex: none; padding-left: 0.444rem; padding-right: 0.444rem; color: var(--accent-text); }
.add { margin-top: 0.222rem; }
</style>
