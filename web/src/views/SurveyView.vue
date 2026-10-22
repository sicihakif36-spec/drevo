<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { store, loadTree, toast } from '../store.js';
import { api } from '../api.js';
import { STATUS, shareSurvey } from '../surveys.js';
import { FIELDS, ROLES, surveyPeople, findMatches } from '@shared/survey.js';
import { fullName, lifespan, parentsOf, spousesOf, childrenOf, siblingsOf, personHas } from '@shared/names.js';
import ChangeList from '../components/ChangeList.vue';
import { ask } from '../components/ask.js';

// Просмотр анкеты и загрузка ответов в дерево. Для каждого человека из анкеты приложение ищет,
// нет ли его уже в дереве; выбрать: «это он», «новый человек» или «пропустить». Загрузка — одно действие в журнале.
const props = defineProps({ id: String });
const router = useRouter();
const s = ref(null);
const error = ref('');
const plan = reactive({}); // id записи -> { action, person_id, fix, replace, edit, find }
const withStory = ref(true);
const photoOn = reactive({});
const notes = ref([]);
const busy = ref(false);
const link = ref(null);

async function load() {
  try {
    s.value = await api('GET', `/api/surveys/${props.id}`);
    for (const f of s.value.files) photoOn[f.id] ??= true;
    for (const { person } of s.value.answers ? surveyPeople(s.value.answers) : []) {
      plan[person.id] ??= { action: null, person_id: null, fix: {}, replace: [], edit: false, find: '' };
    }
  } catch (e) {
    error.value = e.message;
  }
}
onMounted(load);

const P = computed(() => s.value?.answers?.people);
const persons = computed(() => [...(store.idx?.persons.values() || [])]);
// Кем в дереве должен быть человек этой роли, если уже выбраны совпадения: например, родители того, кто заполнял.
const KIN = {
  father: ['self', parentsOf], mother: ['self', parentsOf], ff: ['father', parentsOf], fm: ['father', parentsOf],
  mf: ['mother', parentsOf], mm: ['mother', parentsOf], spouse: ['self', (i, id) => spousesOf(i, id).map((x) => x.spouseId)],
  child: ['self', childrenOf], sibling: ['self', siblingsOf],
};

const TEXT = FIELDS.filter((f) => !['sex', 'living'].includes(f.kind));
const dead = (x) => x.living === false || Boolean((x.death_date || '').trim() || (x.death_place || '').trim());

const rows = computed(() => {
  if (!P.value || !store.idx) return [];
  const chosen = {};
  return surveyPeople(s.value.answers).map(({ role, person: rec }) => {
    const d = plan[rec.id];
    const [anchor, rel] = KIN[role] || [];
    const anchorId = anchor ? chosen[anchor] : null;
    const kin = new Set(role === 'self' ? [s.value.person_id].filter(Boolean) : anchorId ? rel(store.idx, anchorId).filter(Boolean) : []);
    const cands = findMatches(rec, persons.value, kin);
    // Не выбрано вручную: при похожих в дереве нужно решить, иначе — новый человек; к кому привязали анкету — он.
    let action = d.action;
    let personId = d.person_id;
    if (!action && role === 'self' && s.value.person_id && store.idx.persons.has(s.value.person_id)) [action, personId] = ['match', s.value.person_id];
    if (!action && !cands.length) action = 'new';
    if (action === 'match' && role in { self: 1, father: 1, mother: 1 }) chosen[role] = personId;
    const data = { ...rec, ...d.fix };
    const tree = action === 'match' ? store.idx.persons.get(personId) : null;
    return { role, rec, d, cands, action, personId, data, tree, diff: tree ? diff(tree, data) : [] };
  });
});
const undecided = computed(() => rows.value.filter((r) => !r.action || (r.action === 'match' && !r.tree)).length);

// Что изменится у найденного человека: пустое допишется, непустое — только если отметить «заменить».
function diff(p, x) {
  const out = [];
  for (const f of TEXT) {
    const v = (x[f.key] || '').trim();
    if (!v || (f.dead && !dead(x)) || v === p[f.key]) continue;
    out.push({ key: f.key, label: f.label, tree: p[f.key], survey: v, add: !p[f.key] });
  }
  if (x.sex !== 'U' && x.sex !== p.sex) out.push({ key: 'sex', label: 'Пол', tree: p.sex === 'U' ? '' : p.sex === 'F' ? 'женщина' : 'мужчина', survey: x.sex === 'F' ? 'женщина' : 'мужчина', add: p.sex === 'U' });
  const alive = !dead(x);
  if (alive !== p.living && (x.living !== null || !alive)) {
    const word = (l) => (x.sex === 'F' ? (l ? 'жива' : 'умерла') : (l ? 'жив' : 'умер'));
    out.push({ key: 'living', label: 'Жив или умер', tree: word(p.living), survey: word(alive), add: !alive && p.living && !p.death_date && !p.death_place });
  }
  return out;
}

function choose(r, action, personId = null) {
  r.d.action = action;
  r.d.person_id = personId;
  r.d.replace = [];
  r.d.find = '';
}
function toggleReplace(r, key) {
  const i = r.d.replace.indexOf(key);
  if (i >= 0) r.d.replace.splice(i, 1);
  else r.d.replace.push(key);
}
function edit(r) {
  if (!r.d.edit) for (const f of TEXT) r.d.fix[f.key] ??= r.rec[f.key];
  r.d.edit = !r.d.edit;
}
const found = (r) => {
  const t = r.d.find.trim().toLowerCase();
  return t.length < 2 ? [] : persons.value.filter((p) => personHas(p, t)).slice(0, 6);
};
const nameOf = (x) => [x.surname, x.given, x.patronymic].map((v) => (v || '').trim()).filter(Boolean).join(' ');
const dates = (x) => [x.birth_date && `родил${x.sex === 'F' ? 'ась' : 'ся'} ${x.birth_date}`, dead(x) && (x.death_date ? `умер${x.sex === 'F' ? 'ла' : ''} ${x.death_date}` : x.sex === 'F' ? 'умерла' : 'умер')].filter(Boolean).join(', ');
const label = (r) => (r.role === 'self' ? 'Кто заполнял анкету' : ROLES[r.role].label);

async function upload() {
  busy.value = true;
  error.value = '';
  try {
    const people = Object.fromEntries(rows.value.map((r) => [r.rec.id, {
      action: r.action, person_id: r.personId, replace: r.d.replace, fix: r.d.fix,
    }]));
    const photos = s.value.files.filter((f) => photoOn[f.id]).map((f) => f.id);
    const res = await api('POST', `/api/surveys/${props.id}/load`, { people, story: withStory.value, photos });
    notes.value = res.notes;
    await Promise.all([load(), loadTree()]);
    toast('Анкета загружена в дерево');
    window.scrollTo(0, 0);
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

async function newLink() {
  if (!await ask({ text: 'Сделать новую ссылку?', note: 'Старая перестанет работать, а срок начнётся заново.', yes: 'Сделать новую', no: 'Оставить старую' })) return;
  try { link.value = await api('POST', `/api/surveys/${props.id}/link`); await load(); } catch (e) { toast(e.message); }
}
async function revoke() {
  const done = s.value.status === 'submitted';
  if (!await ask(done
    ? { text: 'Не загружать эту анкету?', note: 'Ответы не попадут в дерево, загрузить их потом будет нельзя.', yes: 'Не загружать', no: 'Вернуться к анкете', danger: true }
    : { text: 'Отключить ссылку на анкету?', note: 'Открыть анкету по ней будет нельзя.', yes: 'Отключить ссылку', no: 'Не отключать', danger: true })) return;
  try { await api('DELETE', `/api/surveys/${props.id}`); await load(); } catch (e) { toast(e.message); }
}
const reverted = async () => { notes.value = []; await load(); };
const when = (t) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
// Бумажный бланк с именем из анкеты: расспросить вживую и заполнить анкету по нему.
const blankUrl = computed(() => `/api/survey-blank.pdf?${new URLSearchParams({ name: s.value?.name || '' })}`);
const goPerson = (id) => router.push(`/person/${id}`);
</script>

<template>
  <div class="page">
    <router-link to="/surveys" class="small">‹ Анкеты</router-link>
    <div v-if="!s" :class="error ? 'error' : 'muted'">{{ error || 'Загрузка…' }}</div>
    <template v-else>
      <h1>Анкета: {{ s.name }}</h1>
      <div class="card small">
        <div><b>{{ STATUS[s.status] }}</b></div>
        <div class="muted">Создана {{ when(s.created_at) }}, {{ s.created_by_name }}<template v-if="s.submitted_at">; заполнена {{ when(s.submitted_at) }}</template>
          <template v-else-if="['sent', 'filling'].includes(s.status)">; ссылка работает до {{ when(s.expires_at) }}</template></div>
        <div v-if="s.status === 'loaded'" class="muted">Загружена в дерево {{ when(s.loaded_at) }}, {{ s.loaded_by_name }}</div>
        <div v-if="s.person_id && store.idx?.persons.get(s.person_id)" class="muted">В дереве: {{ fullName(store.idx.persons.get(s.person_id)) }}</div>
      </div>

      <div class="row" style="margin-top:12px">
        <a class="btn grow" :href="blankUrl" target="_blank">Напечатать бланк</a>
      </div>

      <template v-if="['sent', 'filling', 'expired'].includes(s.status)">
        <p class="muted small">{{ s.status === 'filling' ? 'Родственник начал заполнять. Ответы появятся здесь, когда он нажмёт «Отправить».' : 'Ответы появятся здесь, когда анкету отправят.' }}</p>
        <div class="grid2">
          <button @click="newLink">Новая ссылка</button>
          <button v-if="s.status !== 'expired'" class="danger" @click="revoke">Отключить ссылку</button>
        </div>
        <div v-if="link" class="card" style="margin-top:12px">
          <p class="small" style="word-break:break-all;margin-top:0">{{ link.url }}</p>
          <div class="grid2">
            <button class="primary" @click="shareSurvey(link, 'share')">Поделиться</button>
            <button @click="shareSurvey(link, 'copy')">Скопировать</button>
          </div>
        </div>
      </template>

      <!-- Загружена: само действие, его можно отменить целиком -->
      <template v-if="s.status === 'loaded'">
        <div v-if="notes.length" class="banner" style="margin-top:12px">
          Не всё удалось связать:
          <div v-for="(n, i) in notes" :key="i">• {{ n }}</div>
        </div>
        <h2>Что добавлено в дерево</h2>
        <ChangeList v-if="s.load" :ops="[s.load]" @reverted="reverted" />
        <p class="muted small">Отменить загрузку можно здесь или в «Ещё → Последние правки».</p>
      </template>

      <!-- Заполнена: просмотр и загрузка -->
      <template v-if="s.status === 'submitted' && s.answers">
        <h2>Люди из анкеты</h2>
        <p class="muted small">Для каждого выберите: это человек, который уже есть в дереве, новый человек или пропустить.
          У найденного в дереве дописываются только пустые поля.</p>
        <div v-for="r in rows" :key="r.rec.id" class="card rec" :class="{ need: !r.action }">
          <div class="muted small">{{ label(r) }}</div>
          <div class="name">{{ nameOf(r.data) }}</div>
          <div v-if="dates(r.data)" class="muted small">{{ dates(r.data) }}{{ r.data.birth_place ? `, ${r.data.birth_place}` : '' }}</div>

          <div v-if="r.cands.length && r.action !== 'match'" class="banner ask">
            Уже есть в дереве — это {{ r.rec.sex === 'F' ? 'она' : 'он' }}?
            <button v-for="c in r.cands" :key="c.id" class="block cand" @click="choose(r, 'match', c.id)">
              {{ fullName(c) }} <span class="muted small">{{ lifespan(c) }}</span>
            </button>
          </div>

          <div class="seg">
            <button :class="{ on: r.action === 'match' }" @click="choose(r, 'match', r.personId || r.cands[0]?.id || null)">Уже есть</button>
            <button :class="{ on: r.action === 'new' }" @click="choose(r, 'new')">Новый</button>
            <button v-if="r.role !== 'self'" :class="{ on: r.action === 'skip' }" @click="choose(r, 'skip')">Пропустить</button>
          </div>

          <template v-if="r.action === 'match'">
            <div v-if="r.tree" class="row picked">
              <span class="grow">= <a href="#" @click.prevent="goPerson(r.tree.id)">{{ fullName(r.tree) }}</a> <span class="muted small">{{ lifespan(r.tree) }}</span></span>
              <button class="ghost small" @click="r.d.person_id = null; r.d.action = 'match'">Выбрать другого</button>
            </div>
            <template v-else>
              <input v-model="r.d.find" placeholder="Найти в дереве: начните вводить имя" style="margin-top:8px" />
              <div v-if="found(r).length" class="list" style="margin-top:6px">
                <a v-for="p in found(r)" :key="p.id" href="#" @click.prevent="choose(r, 'match', p.id)">{{ fullName(p) }} <span class="muted small">{{ lifespan(p) }}</span></a>
              </div>
            </template>
            <div v-if="r.tree && r.diff.length" class="diff">
              <div v-for="x in r.diff" :key="x.key" class="small">
                <template v-if="x.add"><span class="add">+ {{ x.label }}:</span> {{ x.survey }}</template>
                <label v-else class="conflict">
                  <input type="checkbox" :checked="r.d.replace.includes(x.key)" @change="toggleReplace(r, x.key)" />
                  <span>{{ x.label }}: в дереве «{{ x.tree }}», в анкете «{{ x.survey }}» — <b>заменить</b></span>
                </label>
              </div>
            </div>
            <div v-else-if="r.tree" class="muted small" style="margin-top:6px">Нового о нём в анкете нет.</div>
          </template>

          <template v-if="r.action !== 'skip'">
            <button class="ghost small" @click="edit(r)">{{ r.d.edit ? 'Скрыть поля' : 'Поправить' }}</button>
            <div v-if="r.d.edit">
              <label v-for="f in TEXT" :key="f.key" class="field"><span>{{ f.label }}</span>
                <textarea v-if="f.kind === 'text'" v-model="r.d.fix[f.key]" rows="2" />
                <input v-else v-model="r.d.fix[f.key]" />
              </label>
            </div>
          </template>
        </div>

        <template v-if="s.answers.story.trim()">
          <h2>Воспоминания</h2>
          <div class="card story">{{ s.answers.story }}</div>
          <label class="check"><input v-model="withStory" type="checkbox" /> Добавить как историю у того, кто заполнял</label>
        </template>

        <template v-if="s.files.length">
          <h2>Фото</h2>
          <div class="photos">
            <label v-for="f in s.files" :key="f.id" class="ph">
              <img :src="`/api/surveys/${s.id}/photos/${f.id}`" alt="" loading="lazy" />
              <span class="small">{{ f.caption || 'без подписи' }}</span>
              <span class="check small"><input v-model="photoOn[f.id]" type="checkbox" /> в альбом</span>
            </label>
          </div>
        </template>

        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="undecided" class="muted small" style="margin-top:16px">Осталось решить: {{ undecided }}</p>
        <button class="primary block" style="margin-top:8px" :disabled="busy || undecided > 0" @click="upload">{{ busy ? 'Загружаю…' : 'Загрузить в дерево' }}</button>
        <p class="muted small">Загрузка — одно действие: его можно отменить целиком в «Последних правках».</p>
        <button class="danger block" style="margin-top:0.444rem" @click="revoke">Не загружать эту анкету</button>
      </template>
    </template>
  </div>
</template>

<style scoped>
.rec { margin-top: 0.556rem; }
.rec.need { border-color: var(--oral); box-shadow: inset 3px 0 var(--oral); }
.rec .name { font-weight: 700; overflow-wrap: anywhere; }
.rec .seg { margin-top: 10px; }
.ask { margin: 10px 0 0; }
.cand { margin-top: 0.333rem; background: var(--card); justify-content: flex-start; text-align: left; color: var(--text); flex-wrap: wrap; }
.picked { margin-top: 8px; background: var(--accent-soft); border-radius: 12px; padding: 2px 4px 2px 12px; }
.diff { margin-top: 8px; display: grid; gap: 6px; }
.add { color: var(--accent-text); font-weight: 700; }
.conflict { display: flex; gap: 8px; align-items: flex-start; }
.conflict input, .check input { width: 1.333rem; height: 1.333rem; min-height: 0; flex: none; margin: 1px 0 0; }
.check { display: flex; gap: 0.444rem; align-items: center; margin-top: 0.444rem; min-height: 2.667rem; }
.story { white-space: pre-wrap; max-height: 320px; overflow-y: auto; }
.photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.ph { display: flex; flex-direction: column; gap: 4px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 6px; }
.ph img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; }
</style>
