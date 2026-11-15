<script setup>
import { computed, nextTick, ref } from 'vue';
import { store, loadTree, toast } from '../store.js';
import { api } from '../api.js';
import { fatherMother } from '@shared/layout.js';
import { fullName, lifespan, spousesOf, childrenOf, personHas, nameGenitive } from '@shared/names.js';

// Окно «Родители»: поменять отца или мать, если человека записали не в ту семью
// (например, к первому мужу матери вместо второго). Дети и внуки человека остаются с ним.
const props = defineProps({ person: Object });
const emit = defineEmits(['close']);

const idx = computed(() => store.idx);
const get = (id) => (id ? idx.value.persons.get(id) : null);
const [f0, m0] = fatherMother(idx.value, props.person.id);
const father = ref(f0);
const mother = ref(m0);
const saving = ref(false);
const error = ref('');

// Родителем не может быть сам человек и его потомки.
const own = computed(() => {
  const out = new Set([props.person.id]);
  const queue = [props.person.id];
  while (queue.length) for (const c of childrenOf(idx.value, queue.shift())) if (!out.has(c)) { out.add(c); queue.push(c); }
  return out;
});
// Мужья (жёны) человека: первые, из кого выбирать второго родителя.
const spouses = (id) => (id ? spousesOf(idx.value, id).map((s) => s.spouseId).filter(Boolean) : []);
function options(role) {
  const cur = role === 'father' ? f0 : m0;
  const other = role === 'father' ? [mother.value, m0] : [father.value, f0];
  const ids = [cur, role === 'father' ? father.value : mother.value, ...other.flatMap(spouses)];
  const bad = role === 'father' ? 'F' : 'M';
  return [...new Set(ids)].map(get).filter((p) => p && p.sex !== bad && !own.value.has(p.id));
}
const roles = computed(() => [
  { key: 'father', title: 'Отец', none: 'Не указан', list: options('father'), model: father },
  { key: 'mother', title: 'Мать', none: 'Не указана', list: options('mother'), model: mother },
]);

// Поиск по дереву — когда нужного нет среди мужей и жён.
const searching = ref(null); // 'father' | 'mother'
const query = ref('');
const input = ref(null);
function search(role) {
  searching.value = role;
  query.value = '';
  nextTick(() => input.value?.[0]?.focus());
}
const results = computed(() => {
  const s = query.value.trim();
  if (!s || !searching.value) return [];
  const bad = searching.value === 'father' ? 'F' : 'M';
  return [...idx.value.persons.values()].filter((p) => p.sex !== bad && !own.value.has(p.id) && personHas(p, s)).slice(0, 8);
});
function pick(role, id) {
  (role === 'father' ? father : mother).value = id;
  searching.value = null;
}

const changed = computed(() => father.value !== f0 || mother.value !== m0);
const who = computed(() => props.person.given || fullName(props.person));
const child = computed(() => (props.person.sex === 'F' ? 'дочерью' : props.person.sex === 'M' ? 'сыном' : 'ребёнком'));
const summary = computed(() => {
  const ps = [father.value, mother.value].map(get).filter(Boolean);
  if (!ps.length) return '';
  return `${who.value} будет записан${props.person.sex === 'F' ? 'а' : ''} ${child.value} ${ps.map((p) => nameGenitive(p, true)).join(' и ')}.`;
});

async function save() {
  if (!changed.value) return emit('close');
  if (!father.value && !mother.value) { error.value = 'Укажите отца или мать. Убрать обоих родителей можно в их карточках: «Убрать связь…».'; return; }
  saving.value = true;
  error.value = '';
  try {
    await api('PUT', `/api/persons/${props.person.id}/parents`, { father: father.value, mother: mother.value });
    await loadTree();
    toast('Родители изменены. Вернуть можно в «Главная → Последние правки».');
    emit('close');
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="sheet-backdrop" @click="emit('close')" />
  <form class="sheet psheet" role="dialog" aria-modal="true" aria-labelledby="psheet-title" @submit.prevent="save">
    <h1 id="psheet-title">Родители: {{ fullName(person) }}</h1>
    <p class="muted small">Если записали не к тому отцу или матери — выберите правильных. Дети и внуки {{ nameGenitive(person, true) }} перейдут вместе с {{ person.sex === 'F' ? 'ней' : 'ним' }}.</p>

    <section v-for="r in roles" :key="r.key">
      <h2>{{ r.title }}</h2>
      <div class="list">
        <button v-for="x in r.list" :key="x.id" type="button" :aria-pressed="r.model.value === x.id" @click="r.model.value = x.id">
          <div class="avatar" :class="x.sex">{{ (x.given || '?')[0] }}</div>
          <div class="grow"><div :class="{ b: r.model.value === x.id }">{{ fullName(x) }}</div><div class="muted small">{{ lifespan(x) }}</div></div>
          <span v-if="r.model.value === x.id" class="tick" aria-hidden="true">✓</span>
        </button>
        <button type="button" :aria-pressed="!r.model.value" @click="r.model.value = null">
          <div class="grow" :class="{ b: !r.model.value }">{{ r.none }}</div>
          <span v-if="!r.model.value" class="tick" aria-hidden="true">✓</span>
        </button>
        <button v-if="searching !== r.key" type="button" class="find" @click="search(r.key)">Другой человек из дерева…</button>
        <div v-else class="search">
          <input ref="input" v-model="query" placeholder="Начните вводить имя" :aria-label="`Найти: ${r.title.toLowerCase()}`" />
          <button v-for="x in results" :key="x.id" type="button" @click="pick(r.key, x.id)">
            <div class="avatar" :class="x.sex">{{ (x.given || '?')[0] }}</div>
            <div class="grow"><div>{{ fullName(x) }}</div><div class="muted small">{{ lifespan(x) }}</div></div>
          </button>
          <p v-if="query.trim() && !results.length" class="muted small">Никого не нашлось. Нового человека добавьте в дерево, потом выберите здесь.</p>
        </div>
      </div>
    </section>

    <p v-if="changed && summary" class="summary">{{ summary }}</p>
    <p class="error" v-if="error">{{ error }}</p>
    <div class="row">
      <button type="button" class="grow" @click="emit('close')">Отмена</button>
      <button class="primary grow" :disabled="saving || !changed">{{ saving ? 'Сохраняю…' : 'Сохранить' }}</button>
    </div>
  </form>
</template>

<style scoped>
.psheet h1 { font-size: 1.222rem; overflow-wrap: anywhere; }
.psheet h2 { font-size: 1rem; margin: 0.889rem 0 0.333rem; }
.list > button { display: flex; align-items: center; gap: 0.667rem; width: 100%; text-align: left; }
.b { font-weight: 700; }
.tick { color: var(--accent-text); font-weight: 700; }
.find { color: var(--accent-text); font-weight: 700; }
.search { display: grid; gap: 0.333rem; padding: 0.444rem 0; }
.search input { width: 100%; }
.summary { font-weight: 700; margin: 0.889rem 0 0.444rem; }
</style>
