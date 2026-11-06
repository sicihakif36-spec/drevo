<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store, canEdit, toast } from '../store.js';
import { api } from '../api.js';
import { factInfo } from '../sources.js';
import { fullName } from '@shared/names.js';
import { KINDS, QUALITY, citeText, docCite, pageText, partName, recordText, sourceTitle } from '@shared/sources.js';
import SourceForm from './SourceForm.vue';
import DocPicker from './DocPicker.vue';
import { ask } from './ask.js';

// Окно сведения снизу: достоверность и источники. «Указать источник»: выбрать документ из записанных (метрическая книга
// за год пишется один раз), потом его страницу — уже записанную или новую: лист, номер записи, скан. Или новый документ по шаблону.
// fact — { subject, id, fact, label, value }; без него сначала выбирается сведение из facts.
const props = defineProps({ fact: Object, facts: Array, data: Object, person: Object });
const emit = defineEmits(['close', 'changed']);
const route = useRoute();
const router = useRouter();

const cur = ref(props.fact);
const step = ref(props.fact ? 'main' : 'fact'); // fact, main, pick, pages, page, kind, form
const kind = ref('');
const doc = ref(null); // выбранный документ со страницами
const busy = ref('');
const error = ref('');

const info = computed(() => cur.value && factInfo(props.data, cur.value.subject, cur.value.id, cur.value.fact));
const used = computed(() => new Set(info.value?.cites.map((c) => c.source_id)));
const where = computed(() => ({ subject: cur.value.subject, subject_id: cur.value.id, fact: cur.value.fact }));
// Страницы выбранного документа, ещё не указанные у этого сведения, — с людьми, к которым они уже привязаны.
const pages = computed(() => (doc.value?.pages || []).filter((p) => !used.value.has(p.id)).map((p) => ({
  ...p,
  who: p.persons.map((id) => store.idx?.persons.get(id)).filter(Boolean).map((x) => fullName(x)).join(', '),
})));

// Документ — заголовком над полями новой страницы.
const docHead = computed(() => doc.value && (({ kind, title, archive, fond, opis, delo }) => ({ kind, title, archive, fond, opis, delo }))(doc.value));

function choose(f) {
  cur.value = f;
  step.value = 'main';
}

async function run(fn, done) {
  busy.value = 'Сохраняю…';
  error.value = '';
  try {
    await fn();
    emit('changed');
    if (done) toast(done);
    return true;
  } catch (e) {
    error.value = e.message;
    return false;
  } finally {
    busy.value = '';
  }
}

// Нажатие на выбранную отметку снимает её.
const setQuality = (q) => run(() => api('PUT', '/api/quality', { ...where.value, quality: info.value.quality === q ? null : q }));

function startPick() {
  error.value = '';
  step.value = 'pick';
}

// Документ выбран: показываем его страницы; страниц нет — сразу новая.
async function pickDoc(d) {
  error.value = '';
  doc.value = { ...d, pages: null };
  step.value = 'pages';
  try {
    doc.value = await api('GET', `/api/documents/${d.id}`);
  } catch (e) {
    error.value = e.message;
  }
  if (doc.value.pages && !pages.value.length) step.value = 'page';
}

async function create({ doc: d, page }) {
  if (await run(() => api('POST', '/api/sources', { document: d, ...page, cite: where.value }), 'Источник записан')) step.value = 'main';
}

async function addPage({ page }) {
  if (await run(() => api('POST', '/api/sources', { document_id: doc.value.id, ...page, cite: where.value }), 'Источник записан')) step.value = 'main';
}

async function attach(p) {
  if (await run(() => api('POST', '/api/citations', { ...where.value, source_id: p.id }), 'Источник указан')) step.value = 'main';
}

async function detach(c) {
  if (!await ask({ text: `Убрать источник «${sourceTitle(c.source)}» у этого сведения?`, note: 'Сам источник останется.', yes: 'Убрать', no: 'Не убирать', danger: true })) return;
  await run(() => api('DELETE', `/api/citations/${c.id}`), 'Источник убран');
}

function openSource(id) {
  router.push({ query: { ...route.query, source: id } });
}
</script>

<template>
  <div class="sheet-backdrop" @click="emit('close')" />
  <div class="sheet fsheet" role="dialog" aria-modal="true">
    <template v-if="step === 'fact'">
      <h1>Указать источник</h1>
      <p class="muted">К какому сведению?</p>
      <div class="list">
        <button v-for="f in facts" :key="f.subject + f.id + f.fact" class="pick" @click="choose(f)">
          <span class="grow"><span class="ttl">{{ f.label }}</span><span v-if="f.value" class="muted small ellipsis">{{ f.value }}</span></span>
          <span class="muted">›</span>
        </button>
      </div>
      <button class="block close" @click="emit('close')">Отмена</button>
    </template>

    <template v-else-if="step === 'main'">
      <div class="muted small">{{ cur.label }}</div>
      <h1>{{ cur.value || fullName(person) }}</h1>

      <h2>Достоверность</h2>
      <div v-if="canEdit()" class="qual">
        <button v-for="(q, k) in QUALITY" :key="k" type="button" :class="[k, { on: info.quality === k }]" :disabled="Boolean(busy)"
          :aria-pressed="info.quality === k" @click="setQuality(k)">{{ q.label }}</button>
      </div>
      <p v-else class="muted">{{ info.quality ? QUALITY[info.quality].label : 'Не отмечена' }}</p>
      <p v-if="canEdit() && info.quality" class="muted small">Нажмите ещё раз, чтобы снять отметку.</p>

      <h2>Источники</h2>
      <div class="list">
        <div v-for="c in info.cites" :key="c.id" class="src">
          <button class="grow open" @click="openSource(c.source_id)">
            <span class="ttl">{{ sourceTitle(c.source) }}</span>
            <span v-if="citeText(c.source) || c.source.record" class="small">{{ [citeText(c.source), recordText(c.source.record)].filter(Boolean).join(', ') }}</span>
            <span v-if="c.page" class="small muted">{{ c.page }}</span>
          </button>
          <button v-if="canEdit()" class="danger" :aria-label="`Убрать источник: ${sourceTitle(c.source)}`" @click="detach(c)">✕</button>
        </div>
        <div v-if="!info.cites.length" class="muted">Источник не указан.</div>
      </div>
      <p class="error" v-if="error">{{ error }}</p>
      <button v-if="canEdit()" class="primary block" @click="startPick">+ Указать источник</button>
      <button class="block close" @click="emit('close')">Закрыть</button>
    </template>

    <template v-else-if="step === 'pick'">
      <h1>Указать источник</h1>
      <p class="muted">{{ cur.label }}{{ cur.value ? `: ${cur.value}` : '' }}</p>
      <button class="primary block" @click="step = 'kind'">+ Новый документ</button>
      <h2>Или выберите записанный документ</h2>
      <p class="muted small">Метрическая книга, ревизская сказка, похозяйственная книга… Потом укажете лист и номер записи.</p>
      <DocPicker @pick="pickDoc" @loaded="(n) => { if (!n) step = 'kind'; }" />
      <button class="block close" @click="step = 'main'">Назад</button>
    </template>

    <template v-else-if="step === 'pages'">
      <div class="muted small">{{ KINDS[doc.kind]?.label }}</div>
      <h1>{{ sourceTitle(doc) }}</h1>
      <p v-if="docCite(doc)" class="muted">{{ docCite(doc) }}</p>
      <button class="primary block" @click="error = ''; step = 'page'">+ {{ doc.kind === 'legend' ? 'Новая запись' : 'Новая страница: лист, номер записи, скан' }}</button>
      <h2>Или {{ partName(doc.kind).toLowerCase() }}, уже записанная</h2>
      <div v-if="!doc.pages" class="muted">Загрузка…</div>
      <div v-else class="list found">
        <button v-for="p in pages" :key="p.id" class="pick" :disabled="Boolean(busy)" @click="attach(p)">
          <span class="grow">
            <span class="ttl">{{ pageText(p) || (p.url ? p.url.replace(/^https?:\/\//, '') : '') || p.note || 'Без листа и номера' }}</span>
            <span v-if="p.who" class="muted small">{{ p.who }}</span>
          </span>
          <span class="plus">+</span>
        </button>
        <div v-if="!pages.length" class="muted">Других страниц нет.</div>
      </div>
      <p class="error" v-if="error">{{ error }}</p>
      <button class="block close" @click="step = 'pick'">Назад</button>
    </template>

    <template v-else-if="step === 'page'">
      <h1>{{ partName(doc.kind) }} документа</h1>
      <p class="muted">Для: {{ cur.label.toLowerCase() }}{{ cur.value ? ` — ${cur.value}` : '' }}</p>
      <SourceForm :source="docHead" :person-id="person.id" part :busy="busy" :error="error" @submit="addPage" @cancel="step = doc.pages?.length ? 'pages' : 'pick'" />
    </template>

    <template v-else-if="step === 'kind'">
      <h1>Новый документ</h1>
      <p class="muted">Что это за источник?</p>
      <div class="kinds">
        <button v-for="(k, key) in KINDS" :key="key" type="button" @click="kind = key; error = ''; step = 'form'">{{ k.label }}</button>
      </div>
      <button class="block close" @click="step = 'main'">Отмена</button>
    </template>

    <template v-else-if="step === 'form'">
      <h1>{{ KINDS[kind].label }}</h1>
      <p class="muted">Для: {{ cur.label.toLowerCase() }}{{ cur.value ? ` — ${cur.value}` : '' }}</p>
      <SourceForm :kind="kind" :person-id="person.id" doc part :busy="busy" :error="error" @submit="create" @cancel="step = 'kind'" />
    </template>
  </div>
</template>

<style scoped>
.fsheet h1 { font-size: 1.222rem; overflow-wrap: anywhere; margin-bottom: 4px; }
.fsheet h2 { margin-top: 16px; }
.qual { display: flex; flex-direction: column; gap: 8px; }
.qual button { justify-content: flex-start; background: var(--card); border: 2px solid var(--field); color: var(--text); font-size: 0.944rem; }
.qual button.on { font-weight: 600; }
.qual .document.on { border-color: var(--accent-text); background: var(--accent-soft); color: var(--accent-text); }
.qual .oral.on { border-color: var(--oral); background: var(--oral-soft); color: var(--oral); }
.qual .guess.on { border-color: var(--muted); background: var(--line); }
.qual button.on::after { content: "✓"; margin-left: auto; }
.src { padding: 4px 4px 4px 0 !important; }
.open, .pick { justify-content: flex-start; text-align: left; background: transparent; border-radius: 0; flex-direction: column; align-items: flex-start; gap: 2px; }
.pick { flex-direction: row; align-items: center; width: 100%; }
.pick .grow > span { display: block; }
.ttl { font-size: 0.944rem; font-weight: 600; overflow-wrap: anywhere; }
.plus { font-size: 1.444rem; color: var(--accent-text); }
.found { margin-top: 8px; }
.kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.kinds button { min-height: 60px; font-size: 0.889rem; }
.close { margin-top: 10px; }
.primary.block { margin-top: 12px; }
</style>
