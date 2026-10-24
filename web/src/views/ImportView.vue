<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { store, loadTree, toast, canEdit } from '../store.js';
import { api, upload } from '../api.js';
import { importSummary } from '../history.js';
import { fullName, lifespan, personHas } from '@shared/names.js';
import ChangeList from '../components/ChangeList.vue';
import ImportPerson from '../components/ImportPerson.vue';
import { ask } from '../components/ask.js';

// «Ещё → Загрузить дерево из файла» (владелец и участники). Файл GEDCOM из другой программы или переписанная от руки родословная:
// сначала предпросмотр — сколько людей и кто из них, возможно, уже есть в дереве; для каждого «это он», «новый» или «пропустить».
// У найденного в дереве дописываются только пустые поля. Загрузка — одно действие: его можно отменить целиком.
// ?q=<вопрос> — «Загрузить результат» из «Исследования»: вместо файла вставляется ответ ИИ-помощника,
// сервер сам вырезает из него GEDCOM; дальше — то же самое, а в журнал вопроса пишется запись о загрузке.
const route = useRoute();
const qid = String(route.query.q || '');
const question = ref(null);
const answer = ref('');
const allowed = computed(() => canEdit());
onMounted(async () => {
  if (qid && canEdit()) question.value = await api('GET', `/api/research/${qid}`).catch((e) => ({ error: e.message }));
});
const step = ref('choose'); // choose -> preview -> done
const sent = ref(0); // доля отправленного файла
const error = ref('');
const pv = ref(null); // предпросмотр с сервера
const plan = reactive({}); // ref -> { action, person_id, replace, find }
const open = reactive(new Set()); // раскрытые строки «остальных»
const find = ref('');
const shown = ref(20);
const busy = ref(false);
const result = ref(null);
const op = ref(null);

const ANSWER_MAX = 2 * 1024 * 1024;
async function paste() {
  error.value = '';
  if (!answer.value.trim()) { error.value = 'Вставьте сюда ответ помощника целиком'; return; }
  if (new Blob([answer.value]).size > ANSWER_MAX) { error.value = 'Ответ слишком большой. Попросите помощника прислать только найденных людей.'; return; }
  sent.value = 0.5;
  try {
    pv.value = await api('POST', `/api/research/${qid}/import`, { text: answer.value });
    preview();
  } catch (err) {
    error.value = err.message;
  } finally {
    sent.value = 0;
  }
}
function preview() {
  for (const k of Object.keys(plan)) delete plan[k];
  for (const p of pv.value.people) plan[p.ref] = { action: p.cands.length ? null : 'new', person_id: null, replace: [], find: '' };
  step.value = 'preview';
  window.scrollTo(0, 0);
}

async function choose(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  error.value = '';
  if (!/\.ged$/i.test(file.name) && !await ask({ text: 'Это точно файл родословной?', note: `Нужен файл GEDCOM с расширением .ged, а выбран «${file.name}».`, yes: 'Всё равно открыть', no: 'Выбрать другой' })) return;
  if (file.size > 10 * 1024 * 1024) { error.value = 'Файл больше 10 МБ — такой не загрузить. Если в нём фото, сохраните родословную без них.'; return; }
  sent.value = 0.01;
  try {
    const fd = new FormData();
    fd.append('file', file, file.name);
    pv.value = await upload('/api/import', fd, (x) => { sent.value = Math.max(0.01, x); });
    preview();
  } catch (err) {
    error.value = err.message;
  } finally {
    sent.value = 0;
  }
}

const tree = (id) => store.idx?.persons.get(id);
const people = computed(() => pv.value?.people || []);
const byRef = computed(() => new Map(people.value.map((p) => [p.ref, p])));
// Сначала те, у кого в дереве есть похожие.
const likely = computed(() => people.value.filter((p) => p.cands.some(tree)));
const others = computed(() => people.value.filter((p) => !likely.value.includes(p)));
const found = computed(() => (find.value.trim() ? others.value.filter((p) => personHas(p, find.value)) : others.value));

const count = (n, one, few, many) => {
  const a = n % 10;
  const b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}`;
};
const totals = computed(() => {
  const t = { new: 0, match: 0, skip: 0, open: 0 };
  for (const p of people.value) {
    const d = plan[p.ref];
    if (!d?.action || (d.action === 'match' && !tree(d.person_id))) t.open++;
    else t[d.action]++;
  }
  return t;
});

// Кто это в файле: годы, место рождения и родные — чтобы узнать человека.
const first = (ref) => {
  const p = byRef.value.get(ref);
  return p ? [p.given, p.surname].filter(Boolean).join(' ') : '';
};
function about(p) {
  const out = [];
  const life = lifespan(p);
  if (life) out.push(life);
  if (p.birth_place) out.push(p.birth_place);
  const kid = p.sex === 'F' ? 'дочь' : p.sex === 'M' ? 'сын' : 'ребёнок';
  if (p.parents.length) out.push(`${kid}: ${p.parents.map(first).join(' и ')}`);
  if (p.spouses.length) out.push(`${p.sex === 'F' ? 'муж' : p.sex === 'M' ? 'жена' : 'супруг'}: ${p.spouses.map(first).join(', ')}`);
  if (p.children.length) out.push(`детей: ${p.children.length}`);
  return out.join(' · ');
}

const toggle = (ref) => (open.has(ref) ? open.delete(ref) : open.add(ref));
function restNew() {
  for (const p of people.value) if (!plan[p.ref].action) plan[p.ref].action = 'new';
}

async function cancel() {
  if (!await ask({ text: qid ? 'Не загружать этот ответ?' : 'Не загружать этот файл?', note: 'В дереве ничего не изменится.', yes: 'Не загружать', no: qid ? 'Вернуться к ответу' : 'Вернуться к файлу' })) return;
  await api('DELETE', `/api/import/${pv.value.id}`).catch(() => {});
  pv.value = null;
  step.value = 'choose';
}

// Сколько примерно ждать: тысяча человек — секунды три на сервере.
const wait = computed(() => Math.max(5, Math.round(totals.value.new / 300) * 5));
async function load() {
  // Отправляем только решения, отличные от «новый».
  const decisions = {};
  for (const p of people.value) {
    const d = plan[p.ref];
    if (d.action === 'skip') decisions[p.ref] = { action: 'skip' };
    if (d.action === 'match') decisions[p.ref] = { action: 'match', person_id: d.person_id, replace: d.replace };
  }
  busy.value = true;
  error.value = '';
  try {
    result.value = await api('POST', `/api/import/${pv.value.id}/load`, { people: decisions });
    await loadTree();
    op.value = (await api('GET', '/api/changes')).find((o) => o.id === result.value.change) || null;
    step.value = 'done';
    toast(qid ? 'Результат загружен в дерево' : 'Дерево загружено из файла');
    window.scrollTo(0, 0);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
async function reverted() {
  op.value = (await api('GET', '/api/changes')).find((o) => o.id === result.value.change) || null;
}
</script>

<template>
  <div class="page">
    <router-link v-if="qid && question?.person_id" :to="{ path: `/person/${question.person_id}`, query: { q: qid } }" class="small">‹ К вопросу</router-link>
    <router-link v-else to="/more" class="small">‹ Ещё</router-link>
    <h1>{{ qid ? 'Загрузить результат поиска' : 'Загрузить дерево из файла' }}</h1>
    <p v-if="!allowed" class="muted">Загружать {{ qid ? 'результат поиска' : 'дерево из файла' }} могут владелец и участники.</p>

    <template v-else-if="qid && step === 'choose'">
      <p v-if="question?.error" class="error">{{ question.error }}</p>
      <div v-else class="card">
        <p v-if="question" class="muted small" style="margin-top:0">Вопрос: «{{ question.title }}» — {{ tree(question.person_id) ? fullName(tree(question.person_id)) : '' }}</p>
        <label class="field" style="margin-top:0">
          <span>Ответ помощника</span>
          <textarea v-model="answer" class="answer" placeholder="Вставьте сюда ответ помощника целиком — вместе с отчётом и файлом GEDCOM" />
        </label>
        <p class="small muted">Приложение само найдёт в ответе файл (он начинается с «0 HEAD») и покажет, кто в нём есть
          и кто из них, возможно, уже есть в дереве. Ничего не загрузится, пока вы не нажмёте «Загрузить в дерево».</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button class="primary block" :disabled="sent > 0" @click="paste">{{ sent ? 'Читаю ответ…' : 'Найти людей в ответе' }}</button>
      </div>
    </template>

    <template v-else-if="step === 'choose'">
      <div class="card">
        <p style="margin-top:0">Подойдёт файл <b>GEDCOM</b> (с расширением <b>.ged</b>) из другой программы для родословных
          или с сайта — MyHeritage, Gramps, «Древо Жизни», Geni.</p>
        <p class="small muted">Сначала приложение покажет, кто есть в файле и кто из них, возможно, уже есть в дереве.
          Ничего не загрузится, пока вы не нажмёте «Загрузить в дерево».</p>
        <label class="btn primary block pick" :class="{ disabled: sent }">
          <input type="file" accept=".ged,.GED,text/plain,application/octet-stream" :disabled="sent > 0" @change="choose" />
          {{ sent ? `Отправляю файл… ${Math.round(sent * 100)}%` : 'Выбрать файл' }}
        </label>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </template>

    <template v-else-if="step === 'preview' && pv">
      <div class="card">
        <div class="muted small">{{ qid ? 'Из ответа помощника' : `Файл «${pv.name}»` }}</div>
        <div class="nums">
          <div><b>{{ pv.counts.persons }}</b><span>{{ count(pv.counts.persons, 'человек', 'человека', 'человек').replace(/^\d+ /, '') }}</span></div>
          <div><b>{{ pv.counts.families }}</b><span>{{ count(pv.counts.families, 'семья', 'семьи', 'семей').replace(/^\d+ /, '') }}</span></div>
          <div><b>{{ pv.counts.events }}</b><span>{{ count(pv.counts.events, 'событие', 'события', 'событий').replace(/^\d+ /, '') }}</span></div>
          <div><b>{{ pv.counts.sources }}</b><span>{{ count(pv.counts.sources, 'источник', 'источника', 'источников').replace(/^\d+ /, '') }}</span></div>
        </div>
      </div>
      <div v-if="pv.skipped.length" class="banner" style="margin-top:0.667rem">
        <b>Не загрузится:</b>
        <div v-for="s in pv.skipped" :key="s.label">• {{ s.label }}{{ s.count > 1 ? ` — ${s.count}` : '' }}</div>
      </div>

      <template v-if="likely.length">
        <h2>Возможно, уже есть в дереве — {{ likely.length }}</h2>
        <p class="muted small">Для каждого выберите: это человек из дерева, новый человек или пропустить.
          У найденного в дереве дописываются только пустые поля.</p>
        <ImportPerson v-for="p in likely" :key="p.ref" :p="p" :d="plan[p.ref]" class="card rec" :class="{ need: !plan[p.ref].action }">
          <div v-if="about(p)" class="muted small">{{ about(p) }}</div>
        </ImportPerson>
      </template>

      <template v-if="others.length">
        <h2>{{ likely.length ? 'Остальные' : 'Люди из файла' }} — {{ others.length }}</h2>
        <p class="muted small">Их в дереве не нашлось — они будут добавлены как новые. Если кто-то всё же есть в дереве,
          нажмите на него и выберите «Уже есть».</p>
        <input v-model="find" placeholder="Поиск по файлу: имя или фамилия" @input="shown = 20" />
        <div class="list" style="margin-top:0.444rem">
          <div v-for="p in found.slice(0, shown)" :key="p.ref" class="other">
            <button class="head" @click="toggle(p.ref)">
              <span class="grow"><span class="nm">{{ fullName(p) }}</span><span v-if="about(p)" class="muted small">{{ about(p) }}</span></span>
              <span class="tag" :class="plan[p.ref].action">{{ plan[p.ref].action === 'skip' ? 'пропустить' : plan[p.ref].action === 'match' ? 'уже есть' : 'новый' }}</span>
            </button>
            <ImportPerson v-if="open.has(p.ref)" :p="p" :d="plan[p.ref]" bare class="body" />
          </div>
          <div v-if="!found.length" class="muted">Никого не нашлось</div>
        </div>
        <button v-if="found.length > shown" class="block" style="margin-top:0.444rem" @click="shown += 50">Показать ещё ({{ found.length - shown }})</button>
      </template>

      <div class="card total">
        <div>Будет добавлено новых: <b>{{ totals.new }}</b></div>
        <div v-if="totals.match">Дополнится карточек в дереве: <b>{{ totals.match }}</b></div>
        <div v-if="totals.skip">Пропустить: <b>{{ totals.skip }}</b></div>
        <div v-if="totals.open" class="need-text">Осталось решить: <b>{{ totals.open }}</b></div>
      </div>
      <button v-if="totals.open" class="block" style="margin-top:0.444rem" @click="restNew">Всех, кого не решили, — новыми</button>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="primary block" style="margin-top:0.667rem" :disabled="busy || totals.open > 0 || !(totals.new + totals.match)" @click="load">
        {{ busy ? 'Загружаю…' : 'Загрузить в дерево' }}
      </button>
      <p v-if="busy" class="small">Это может занять до {{ wait }} секунд. Не закрывайте страницу.</p>
      <p class="muted small">Загрузка — одно действие: его можно отменить целиком в «Последних правках».</p>
      <button class="ghost block" :disabled="busy" @click="cancel">Не загружать</button>
    </template>

    <template v-else-if="step === 'done' && result">
      <div class="card">
        <b>Готово: {{ importSummary(result) }}</b>
        <p class="small muted" style="margin-bottom:0">Новые люди уже в дереве и в «Людях».</p>
      </div>
      <div v-if="result.notes.length" class="banner" style="margin-top:0.667rem">
        Не всё удалось связать:
        <div v-for="(n, i) in result.notes" :key="i">• {{ n }}</div>
      </div>
      <p v-if="result.note" class="small">В журнал вопроса записано, что загружено, вместе с отчётом помощника.</p>
      <div class="grid2" style="margin-top:0.667rem">
        <router-link class="btn primary" to="/">Открыть дерево</router-link>
        <router-link v-if="qid && question?.person_id" class="btn" :to="{ path: `/person/${question.person_id}`, query: { q: qid } }">К вопросу</router-link>
        <router-link v-else class="btn" to="/people">Люди</router-link>
      </div>
      <h2>Что сделано</h2>
      <ChangeList v-if="op" :ops="[op]" @reverted="reverted" />
      <p class="muted small">Если загрузилось не то — нажмите «Отменить» выше: всё {{ qid ? 'из ответа' : 'из файла' }} уйдёт из дерева одним действием.</p>
    </template>
  </div>
</template>

<style scoped>
.pick { position: relative; margin-top: 0.667rem; }
.pick input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
.pick.disabled { opacity: 0.7; }
.answer { min-height: 45vh; font-size: 0.889rem; }
.nums { display: grid; grid-template-columns: 1fr 1fr; gap: 0.444rem 0.889rem; margin-top: 0.444rem; }
.nums div { display: flex; flex-direction: column; }
.nums b { font-size: 1.778rem; line-height: 1.1; }
.nums span { color: var(--muted); }
.rec { margin-top: 0.556rem; }
.rec.need { border-color: var(--oral); box-shadow: inset 3px 0 var(--oral); }
.nm { display: block; font-weight: 700; overflow-wrap: anywhere; }
.list > .other { display: block; padding: 0; }
.other .head { display: flex; width: 100%; gap: 0.5rem; align-items: center; border: 0; border-radius: 0; background: transparent; color: inherit;
  font-weight: 400; text-align: left; justify-content: flex-start; padding: 0.667rem 1rem; min-height: 3.333rem; }
.other .body { padding: 0 1rem 0.667rem; }
.tag { flex: none; font-size: 0.778rem; padding: 0.111rem 0.444rem; border-radius: 999px; background: var(--accent-soft); color: var(--accent-text); }
.tag.skip { background: var(--line); color: var(--muted); }
.tag.match { background: var(--warn-bg); color: var(--warn-text); }
.total { margin-top: 1.333rem; display: grid; gap: 0.222rem; }
.need-text { color: var(--warn-text); }
</style>
