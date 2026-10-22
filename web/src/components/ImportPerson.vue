<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { store } from '../store.js';
import { FIELDS } from '../history.js';
import { fullName, lifespan, personHas } from '@shared/names.js';

// Человек из файла при загрузке (views/ImportView.vue): «уже есть в дереве», «новый» или «пропустить».
// d — решение о нём ({ action, person_id, replace, find }), меняется здесь же. bare — без имени (оно уже в строке списка).
const props = defineProps({ p: { type: Object, required: true }, d: { type: Object, required: true }, bare: Boolean });
const router = useRouter();

const tree = (id) => store.idx?.persons.get(id);
const cands = computed(() => props.p.cands.map(tree).filter(Boolean));
const picked = computed(() => (props.d.action === 'match' ? tree(props.d.person_id) : null));
const he = computed(() => (props.p.sex === 'F' ? 'она' : 'он'));

function decide(action, personId = null) {
  Object.assign(props.d, { action, person_id: personId, replace: [], find: '' });
}
const found = computed(() => {
  const t = props.d.find.trim();
  return t.length < 2 ? [] : [...(store.idx?.persons.values() || [])].filter((x) => personHas(x, t)).slice(0, 6);
});

// Что изменится у найденного: пустое допишется, непустое — только если отметить «заменить».
const sexWord = (s) => (s === 'F' ? 'женщина' : s === 'M' ? 'мужчина' : '');
const diff = computed(() => {
  const t = picked.value;
  const x = props.p;
  if (!t) return [];
  const out = [];
  for (const [key, label] of FIELDS) {
    const v = (x[key] || '').trim();
    if (v && v !== t[key]) out.push({ key, label, tree: t[key], file: v, add: !t[key] });
  }
  if (x.sex !== 'U' && x.sex !== t.sex) out.push({ key: 'sex', label: 'Пол', tree: sexWord(t.sex), file: sexWord(x.sex), add: t.sex === 'U' });
  if (x.living !== t.living) {
    const word = (l) => (x.sex === 'F' ? (l ? 'жива' : 'умерла') : (l ? 'жив' : 'умер'));
    out.push({ key: 'living', label: 'Жив или умер', tree: word(t.living), file: word(x.living), add: !x.living && t.living && !t.death_date && !t.death_place });
  }
  return out;
});
function toggleReplace(key) {
  const i = props.d.replace.indexOf(key);
  if (i >= 0) props.d.replace.splice(i, 1);
  else props.d.replace.push(key);
}
</script>

<template>
  <div class="ip">
    <template v-if="!bare">
      <div class="name">{{ fullName(p) }}</div>
      <slot />
    </template>
    <div v-if="d.action !== 'match' && cands.length" class="banner ask">
      Уже есть в дереве — это {{ he }}?
      <button v-for="c in cands" :key="c.id" class="block cand" @click="decide('match', c.id)">
        {{ fullName(c) }} <span class="muted small">{{ lifespan(c) }}</span>
      </button>
    </div>
    <div class="seg">
      <button :class="{ on: d.action === 'match' }" @click="decide('match', d.person_id || cands[0]?.id || null)">Уже есть</button>
      <button :class="{ on: d.action === 'new' }" @click="decide('new')">Новый</button>
      <button :class="{ on: d.action === 'skip' }" @click="decide('skip')">Пропустить</button>
    </div>
    <template v-if="d.action === 'match'">
      <div v-if="picked" class="row picked">
        <span class="grow">= <a href="#" @click.prevent="router.push(`/person/${picked.id}`)">{{ fullName(picked) }}</a>
          <span class="muted small">{{ lifespan(picked) }}</span></span>
        <button class="ghost small" @click="d.person_id = null">Другой</button>
      </div>
      <template v-else>
        <input v-model="d.find" placeholder="Найти в дереве: начните вводить имя" class="find" />
        <div v-if="found.length" class="list" style="margin-top:0.333rem">
          <a v-for="x in found" :key="x.id" href="#" @click.prevent="decide('match', x.id)">{{ fullName(x) }} <span class="muted small">{{ lifespan(x) }}</span></a>
        </div>
        <div v-else-if="d.find.trim().length >= 2" class="muted small" style="margin-top:0.333rem">В дереве никого не нашлось</div>
      </template>
      <div v-if="picked" class="diff">
        <div v-for="x in diff" :key="x.key" class="small">
          <template v-if="x.add"><span class="add">+ {{ x.label }}:</span> {{ x.file }}</template>
          <label v-else class="conflict">
            <input type="checkbox" :checked="d.replace.includes(x.key)" @change="toggleReplace(x.key)" />
            <span>{{ x.label }}: в дереве «{{ x.tree }}», в файле «{{ x.file }}» — <b>заменить</b></span>
          </label>
        </div>
        <div v-if="!diff.length" class="muted small">Нового о {{ p.sex === 'F' ? 'ней' : 'нём' }} в файле нет.</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.name { font-weight: 700; overflow-wrap: anywhere; }
.seg { margin-top: 0.556rem; }
.ask { margin: 0.556rem 0 0; }
.cand { margin-top: 0.333rem; background: var(--card); justify-content: flex-start; text-align: left; color: var(--text); flex-wrap: wrap; }
.picked { margin-top: 0.444rem; background: var(--accent-soft); border-radius: 12px; padding: 2px 4px 2px 12px; }
.find { margin-top: 0.444rem; }
.diff { margin-top: 0.444rem; display: grid; gap: 0.333rem; }
.add { color: var(--accent-text); font-weight: 700; }
.conflict { display: flex; gap: 0.444rem; align-items: flex-start; }
.conflict input { width: 1.333rem; height: 1.333rem; min-height: 0; flex: none; margin: 1px 0 0; }
</style>
