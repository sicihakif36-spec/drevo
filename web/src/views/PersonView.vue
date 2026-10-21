<script setup>
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { store, loadTree, canEdit, toast, onLive } from '../store.js';
import { api, photoUrl } from '../api.js';
import { openAdd } from '../components/addState.js';
import ChangeList from '../components/ChangeList.vue';
import Discussion from '../components/Discussion.vue';
import Album from '../components/Album.vue';
import Stories from '../components/Stories.vue';
import Life from '../components/Life.vue';
import MarriageSheet from '../components/MarriageSheet.vue';
import Sources from '../components/Sources.vue';
import FactBadge from '../components/FactBadge.vue';
import FactSheet from '../components/FactSheet.vue';
import { factInfo, personFacts } from '../sources.js';
import { FIELDS } from '../history.js';
import { fullName, lifespan, kinship, parentsOf, spousesOf, siblingsOf, missingFields } from '@shared/names.js';

const props = defineProps({ id: String });
const router = useRouter();
const idx = computed(() => store.idx);
const p = computed(() => idx.value?.persons.get(props.id));
const editing = ref(false);
const saving = ref(false);
const error = ref('');
const form = reactive({});
const history = ref([]);
const showHistory = ref(false);
const album = ref(null);
const marriage = ref(null); // { family, spouse } — окно «Брак»

const kin = computed(() => p.value && kinship(idx.value, store.me?.person_id, p.value.id));
const missing = computed(() => (p.value ? missingFields(p.value, idx.value) : []));
const parents = computed(() => (p.value ? parentsOf(idx.value, p.value.id).map((id) => idx.value.persons.get(id)) : []));
const marriages = computed(() => (p.value ? spousesOf(idx.value, p.value.id).map((s) => {
  const fam = idx.value.families.get(s.familyId);
  return { ...s, fam, spouse: s.spouseId && idx.value.persons.get(s.spouseId), kids: fam.children.map((c) => idx.value.persons.get(c)).filter(Boolean) };
}) : []));
// Источники и достоверность сведений: значки у дат и мест, окно сведения, раздел «Источники».
const sources = ref(null);
const sheet = ref(null); // { fact } — открытое окно сведения; fact null — сначала выбрать сведение
const facts = computed(() => (p.value ? personFacts(p.value, marriages.value) : []));
const fact = (subject, id, key) => facts.value.find((f) => f.subject === subject && f.id === id && f.fact === key);
const info = (subject, id, key) => factInfo(sources.value, subject, id, key);
async function loadSources() {
  const id = props.id;
  if (!p.value || p.value.hidden) {
    sources.value = { quality: [], citations: [], sources: [] };
    return;
  }
  const data = await api('GET', `/api/persons/${id}/sources`).catch(() => null);
  if (props.id === id) sources.value = data;
}
// Дерево перечитывается при каждой правке — источники заново грузим только для другого человека.
watch(() => `${props.id}:${Boolean(p.value)}:${Boolean(p.value?.hidden)}`, () => { sources.value = null; sheet.value = null; loadSources(); }, { immediate: true });
// «жена · брак 1945, с. Горки · развод 1962».
function bond(m) {
  const f = m.fam;
  const who = m.spouse.sex === 'F' ? 'жена' : 'муж';
  const start = f.start_date || f.place ? `${f.kind === 'partners' ? 'вместе с' : 'брак'} ${[f.start_date, f.place].filter(Boolean).join(', ')}` : '';
  return [who, start, f.ended === 'divorce' && `развод${f.end_date ? ` ${f.end_date}` : ''}`].filter(Boolean).join(' · ');
}
const siblings = computed(() => (p.value ? siblingsOf(idx.value, p.value.id).map((id) => idx.value.persons.get(id)).filter(Boolean) : []));

const scrollTo = (x, y) => window.scrollTo(x, y);
function startEdit() {
  Object.assign(form, Object.fromEntries([...FIELDS.map(([k]) => [k, p.value[k]]), ['sex', p.value.sex], ['living', p.value.living]]));
  editing.value = true;
}

async function save() {
  saving.value = true;
  error.value = '';
  try {
    await api('PATCH', `/api/persons/${p.value.id}`, { ...form, death_date: form.living ? '' : form.death_date, version: p.value.version });
    await loadTree();
    editing.value = false;
    toast('Сохранено');
  } catch (e) {
    error.value = e.message;
    if (e.status === 409) await loadTree();
  } finally {
    saving.value = false;
  }
}

// Фото в шапке: открыть его в альбоме, а если фото нет — добавить.
function headPhoto() {
  if (p.value.photo_id) album.value.show(p.value.photo_id);
  else if (canEdit()) album.value.add();
}

async function removePerson() {
  if (!confirm(`Удалить ${fullName(p.value)} из дерева? Это можно отменить в истории правок.`)) return;
  await api('DELETE', `/api/persons/${p.value.id}`);
  await loadTree();
  toast('Удалено. Отменить можно в «Ещё → Последние правки».');
  router.replace('/');
}

async function unlink(familyId, personId, what) {
  if (!confirm(`Убрать связь «${what}»? Сами люди останутся в дереве.`)) return;
  await api('DELETE', `/api/families/${familyId}/members/${personId}`);
  await loadTree();
}

async function setMe() {
  await api('PATCH', '/api/me', { person_id: p.value.id });
  await loadTree();
  toast('Теперь родство считается от этого человека');
}

function showOnTree() {
  store.treeRoot = p.value.id;
  router.push('/');
}

async function reloadHistory() {
  if (p.value) history.value = await api('GET', `/api/persons/${p.value.id}/history`);
}
async function loadHistory() {
  showHistory.value = !showHistory.value;
  if (showHistory.value) await reloadHistory();
}

watch(() => props.id, () => { editing.value = false; showHistory.value = false; });
onUnmounted(onLive((events) => {
  if (!events.some((e) => e.kind === 'tree')) return;
  loadSources();
  if (showHistory.value) return reloadHistory();
}));
</script>

<template>
  <div class="page" v-if="!p"><p class="muted">{{ store.tree ? 'Человек не найден или удалён.' : 'Загрузка…' }}</p><router-link to="/">К дереву</router-link></div>
  <div class="page" v-else>
    <div class="row" style="margin-bottom:8px">
      <button class="ghost" @click="router.back()" aria-label="Назад">‹ Назад</button>
      <span class="grow" />
      <button v-if="canEdit() && !editing" @click="startEdit">Изменить</button>
    </div>

    <div class="head">
      <div class="photo" :class="p.sex" @click="headPhoto">
        <img v-if="p.photo_id" :src="photoUrl(p.photo_id)" alt="" />
        <span v-else>{{ canEdit() ? '+ фото' : (p.given || '?')[0] }}</span>
      </div>
      <h1>{{ fullName(p) }}</h1>
      <div class="muted">{{ [lifespan(p), kin].filter(Boolean).join(' · ') }}</div>
      <div v-if="p.birth_surname && p.birth_surname !== p.surname" class="muted small">урождённая(-ый) {{ p.birth_surname }}</div>
      <FactBadge v-if="!p.hidden" :info="info('person', p.id, 'name')" :editable="canEdit()" @open="sheet = { fact: fact('person', p.id, 'name') }" />
    </div>

    <div v-if="missing.length && canEdit() && !editing" class="banner">Не хватает: {{ missing.join(', ') }}</div>

    <form v-if="editing" @submit.prevent="save" class="card">
      <div class="seg" style="margin-bottom:8px">
        <button type="button" :class="{ on: form.sex === 'M' }" @click="form.sex = 'M'">Мужчина</button>
        <button type="button" :class="{ on: form.sex === 'F' }" @click="form.sex = 'F'">Женщина</button>
      </div>
      <div class="seg">
        <button type="button" :class="{ on: form.living }" @click="form.living = true">Жив(а)</button>
        <button type="button" :class="{ on: !form.living }" @click="form.living = false">Умер(ла)</button>
      </div>
      <template v-for="[k, label] in FIELDS" :key="k">
        <label class="field" v-if="form.living ? !['death_date', 'death_place', 'burial_place'].includes(k) : true">
          <span>{{ label }}</span>
          <textarea v-if="k === 'notes'" v-model="form[k]" />
          <input v-else v-model="form[k]" :placeholder="k.endsWith('_date') ? 'например: 12.03.1890, около 1890, до 1917' : ''" />
        </label>
      </template>
      <p class="error" v-if="error">{{ error }}</p>
      <div class="row">
        <button type="button" class="grow" @click="editing = false">Отмена</button>
        <button class="primary grow" :disabled="saving">{{ saving ? 'Сохраняю…' : 'Сохранить' }}</button>
      </div>
    </form>

    <div v-else class="list">
      <template v-for="[k, label] in FIELDS" :key="k">
        <div v-if="p[k] && !['surname', 'given', 'patronymic', 'birth_surname'].includes(k)" class="fact">
          <div class="grow">
            <div class="muted small">{{ label }}</div>
            <div class="pre">{{ p[k] }}</div>
          </div>
          <FactBadge v-if="fact('person', p.id, k)" :info="info('person', p.id, k)" :editable="canEdit()" @open="sheet = { fact: fact('person', p.id, k) }" />
        </div>
      </template>
      <div v-if="p.hidden" class="muted small">Даты, места и фото живых родственников видны только участникам дерева.</div>
      <div v-else-if="!FIELDS.some(([k]) => p[k] && !['surname', 'given', 'patronymic'].includes(k))" class="muted">Подробностей пока нет.</div>
    </div>

    <h2>Родители</h2>
    <div class="list">
      <router-link v-for="x in parents" :key="x.id" :to="`/person/${x.id}`">
        <div class="avatar" :class="x.sex">{{ (x.given || '?')[0] }}</div>
        <div class="grow"><div class="ellipsis">{{ fullName(x) }}</div><div class="muted small">{{ lifespan(x) }}</div></div>
      </router-link>
      <div v-if="canEdit() && parents.length < 2" class="row wrap">
        <button v-if="!parents.some((x) => x.sex === 'M')" @click="openAdd({ to: p.id, type: 'father' })">+ Отец</button>
        <button v-if="!parents.some((x) => x.sex === 'F')" @click="openAdd({ to: p.id, type: 'mother' })">+ Мать</button>
      </div>
      <div v-else-if="!parents.length" class="muted">Не указаны</div>
    </div>

    <h2>Семья</h2>
    <div class="list">
      <template v-for="m in marriages" :key="m.familyId">
        <router-link v-if="m.spouse" :to="`/person/${m.spouse.id}`">
          <div class="avatar" :class="m.spouse.sex">{{ (m.spouse.given || '?')[0] }}</div>
          <div class="grow"><div class="ellipsis">{{ fullName(m.spouse) }}</div><div class="muted small">{{ bond(m) }}</div></div>
          <FactBadge v-if="!editing && !m.spouse.hidden && !p.hidden" :info="info('family', m.familyId, 'marriage')" :editable="canEdit()"
            @open="sheet = { fact: fact('family', m.familyId, 'marriage') }" />
          <button v-if="editing" class="danger" @click.prevent="unlink(m.familyId, m.spouse.id, 'супруг')">✕</button>
        </router-link>
        <button v-if="m.spouse && canEdit() && !editing" class="bond" @click="marriage = { family: m.fam, spouse: m.spouse }">
          <span class="grow">{{ m.fam.start_date || m.fam.place ? 'Изменить' : 'Указать' }} {{ m.fam.kind === 'partners' ? 'сведения о союзе' : 'дату и место брака' }}</span>
          <span class="muted">›</span>
        </button>
        <router-link v-for="c in m.kids" :key="c.id" :to="`/person/${c.id}`" class="kid">
          <div class="avatar" :class="c.sex">{{ (c.given || '?')[0] }}</div>
          <div class="grow"><div class="ellipsis">{{ fullName(c) }}</div><div class="muted small">{{ [c.sex === 'F' ? 'дочь' : 'сын', lifespan(c)].filter(Boolean).join(' · ') }}</div></div>
          <button v-if="editing" class="danger" @click.prevent="unlink(m.familyId, c.id, 'ребёнок')">✕</button>
        </router-link>
      </template>
      <div v-if="!marriages.length" class="muted">Супруги и дети не указаны</div>
      <div v-if="canEdit()" class="row wrap">
        <button @click="openAdd({ to: p.id, type: 'spouse' })">+ Супруг(а)</button>
        <button @click="openAdd({ to: p.id, type: 'child' })">+ Ребёнок</button>
      </div>
    </div>

    <h2>Братья и сёстры</h2>
    <div class="list">
      <router-link v-for="x in siblings" :key="x.id" :to="`/person/${x.id}`">
        <div class="avatar" :class="x.sex">{{ (x.given || '?')[0] }}</div>
        <div class="grow"><div class="ellipsis">{{ fullName(x) }}</div><div class="muted small">{{ lifespan(x) }}</div></div>
      </router-link>
      <div v-if="!siblings.length && !canEdit()" class="muted">Не указаны</div>
      <div v-if="canEdit()" class="row"><button @click="openAdd({ to: p.id, type: 'sibling' })">+ Брат / сестра</button></div>
    </div>

    <Life :person="p" :sources="sources" @edit="startEdit(); scrollTo(0, 0)" @changed="loadSources" />

    <Album ref="album" :person="p" />

    <Stories :person="p" />

    <Sources :person="p" :data="sources" @cite="sheet = { fact: null }" @changed="loadSources" />

    <Discussion :person="p" />

    <h2>Ещё</h2>
    <div class="list">
      <a href="#" @click.prevent="showOnTree">Показать в центре дерева</a>
      <a href="#" v-if="store.me?.person_id !== p.id" @click.prevent="setMe">Это я (считать родство от этого человека)</a>
      <a :href="`/api/print.pdf?root=${p.id}&mode=hourglass`" target="_blank">Распечатать дерево вокруг этого человека</a>
      <a href="#" v-if="canEdit()" @click.prevent="loadHistory">История правок</a>
      <a href="#" v-if="canEdit()" class="danger-link" @click.prevent="removePerson">Удалить из дерева</a>
    </div>

    <FactSheet v-if="sheet" :key="sheet.fact ? sheet.fact.subject + sheet.fact.id + sheet.fact.fact : 'pick'" :fact="sheet.fact" :facts="facts"
      :data="sources" :person="p" @close="sheet = null" @changed="loadSources" />

    <MarriageSheet v-if="marriage" :family="marriage.family" :spouse="marriage.spouse" @close="marriage = null" />

    <ChangeList v-if="showHistory" :ops="history" style="margin-top:10px" @reverted="reloadHistory" />
  </div>
</template>

<style scoped>
.head { text-align: center; margin: 4px 0 16px; }
.head h1 { margin: 12px 0 4px; }
.photo { width: 132px; height: 132px; border-radius: 28px; margin: 0 auto; overflow: hidden; display: grid; place-items: center; background: var(--line); color: var(--muted); font-size: 18px; }
.photo.M { background: var(--male-soft); color: var(--male); }
.photo.F { background: var(--female-soft); color: var(--female); }
.photo img { width: 100%; height: 100%; object-fit: cover; }
.fact { align-items: flex-start !important; }
.fact .badge { margin-top: 6px; }
.head .badge { margin-top: 8px; }
.pre { white-space: pre-wrap; }
.kid { padding-left: 32px !important; }
.bond { justify-content: flex-start; text-align: left; background: transparent; border-radius: 0; width: 100%; padding-left: 72px !important; color: var(--accent); font-size: 15px; min-height: 44px !important; }
.danger-link { color: var(--danger) !important; }
</style>
