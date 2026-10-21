<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { canEdit, toast } from '../store.js';
import { api } from '../api.js';
import { factInfo } from '../sources.js';
import { fullName } from '@shared/names.js';
import { KINDS, QUALITY, citeText, sourceTitle } from '@shared/sources.js';
import SourceForm from './SourceForm.vue';

// Окно сведения снизу: достоверность и источники, «Указать источник» — выбрать записанный или создать новый по шаблону.
// fact — { subject, id, fact, label, value }; без него сначала выбирается сведение из facts.
const props = defineProps({ fact: Object, facts: Array, data: Object, person: Object });
const emit = defineEmits(['close', 'changed']);
const route = useRoute();
const router = useRouter();

const cur = ref(props.fact);
const step = ref(props.fact ? 'main' : 'fact'); // fact, main, pick, kind, form, page
const kind = ref('');
const chosen = ref(null); // уже записанный источник, к которому пишем уточнение
const pageText = ref('');
const all = ref(null); // все источники для выбора
const query = ref('');
const busy = ref('');
const error = ref('');

const info = computed(() => cur.value && factInfo(props.data, cur.value.subject, cur.value.id, cur.value.fact));
const used = computed(() => new Set(info.value?.cites.map((c) => c.source_id)));
const found = computed(() => {
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean);
  return (all.value || []).filter((s) => !used.value.has(s.id))
    .filter((s) => words.every((w) => `${sourceTitle(s)} ${citeText(s)} ${s.note}`.toLowerCase().includes(w)));
});
const where = computed(() => ({ subject: cur.value.subject, subject_id: cur.value.id, fact: cur.value.fact }));

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

async function startPick() {
  error.value = '';
  query.value = '';
  step.value = 'pick';
  all.value = await api('GET', '/api/sources').catch(() => []);
  if (!all.value.length) step.value = 'kind';
}

async function create({ fields, page }) {
  if (await run(() => api('POST', '/api/sources', { ...fields, cite: { ...where.value, page } }), 'Источник записан')) step.value = 'main';
}

async function attach() {
  if (await run(() => api('POST', '/api/citations', { ...where.value, source_id: chosen.value.id, page: pageText.value }), 'Источник указан')) {
    step.value = 'main';
  }
}

async function detach(c) {
  if (!confirm(`Убрать источник «${sourceTitle(c.source)}» у этого сведения? Сам источник останется.`)) return;
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
            <span v-if="citeText(c.source)" class="small">{{ citeText(c.source) }}</span>
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
      <button class="primary block" @click="step = 'kind'">+ Новый источник</button>
      <h2>Или выберите записанный</h2>
      <input v-if="(all || []).length > 5" v-model="query" type="search" placeholder="Поиск по названию или архиву" />
      <div v-if="all === null" class="muted">Загрузка…</div>
      <div v-else class="list found">
        <button v-for="s in found" :key="s.id" class="pick" @click="chosen = s; pageText = ''; step = 'page'">
          <span class="grow">
            <span class="ttl">{{ sourceTitle(s) }}</span>
            <span class="muted small">{{ citeText(s) || KINDS[s.kind]?.label }}</span>
          </span>
          <span class="plus">+</span>
        </button>
        <div v-if="!found.length" class="muted">{{ query ? 'Ничего не нашлось.' : 'Других записанных источников нет.' }}</div>
      </div>
      <button class="block close" @click="step = 'main'">Назад</button>
    </template>

    <template v-else-if="step === 'kind'">
      <h1>Новый источник</h1>
      <p class="muted">Что это за источник?</p>
      <div class="kinds">
        <button v-for="(k, key) in KINDS" :key="key" type="button" @click="kind = key; error = ''; step = 'form'">{{ k.label }}</button>
      </div>
      <button class="block close" @click="step = 'main'">Отмена</button>
    </template>

    <template v-else-if="step === 'form'">
      <h1>{{ KINDS[kind].label }}</h1>
      <p class="muted">Для: {{ cur.label.toLowerCase() }}{{ cur.value ? ` — ${cur.value}` : '' }}</p>
      <SourceForm :kind="kind" :person-id="person.id" page :busy="busy" :error="error" @submit="create" @cancel="step = 'kind'" />
    </template>

    <template v-else-if="step === 'page'">
      <h1>{{ sourceTitle(chosen) }}</h1>
      <p v-if="citeText(chosen)" class="muted">{{ citeText(chosen) }}</p>
      <label class="field"><span>Уточнение: номер записи, страница (если есть)</span>
        <input v-model="pageText" maxlength="300" placeholder="например: запись № 57" />
      </label>
      <p class="error" v-if="error">{{ error }}</p>
      <div class="row">
        <button class="grow" @click="step = 'pick'">Назад</button>
        <button class="primary grow" :disabled="Boolean(busy)" @click="attach">{{ busy || 'Указать' }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fsheet h1 { font-size: 22px; overflow-wrap: anywhere; margin-bottom: 4px; }
.fsheet h2 { margin-top: 16px; }
.qual { display: flex; flex-direction: column; gap: 8px; }
.qual button { justify-content: flex-start; background: var(--card); border: 2px solid var(--line); font-size: 17px; }
.qual button.on { font-weight: 600; }
.qual .document.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.qual .oral.on { border-color: var(--oral); background: var(--oral-soft); color: var(--oral); }
.qual .guess.on { border-color: var(--muted); background: var(--line); }
.qual button.on::after { content: "✓"; margin-left: auto; }
.src { padding: 4px 4px 4px 0 !important; }
.open, .pick { justify-content: flex-start; text-align: left; background: transparent; border-radius: 0; flex-direction: column; align-items: flex-start; gap: 2px; }
.pick { flex-direction: row; align-items: center; width: 100%; }
.pick .grow > span { display: block; }
.ttl { font-size: 17px; font-weight: 600; overflow-wrap: anywhere; }
.plus { font-size: 26px; color: var(--accent); }
.found { margin-top: 8px; }
.kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.kinds button { min-height: 60px; font-size: 16px; }
.close { margin-top: 10px; }
.primary.block { margin-top: 12px; }
</style>
