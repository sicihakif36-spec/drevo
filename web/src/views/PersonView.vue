<script setup>
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { store, loadTree, canEdit, canTalk, toast, onLive } from '../store.js';
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
import DateInput from '../components/DateInput.vue';
import PlaceInput from '../components/PlaceInput.vue';
import { placeKey } from '@shared/places.js';
import { factInfo, personFacts } from '../sources.js';
import { FIELDS } from '../history.js';
import { fullName, dateText, lifespan, kinship, parentsOf, spousesOf, siblingsOf, missingFields, nameAccusative, nameGenitive } from '@shared/names.js';
import { ask } from '../components/ask.js';

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
const linking = ref(false); // «Убрать связь»: у мужа, жены и детей появляется кнопка
// Сколько фото, историй, источников, сообщений — для закладок под именем; null — ещё не знаем.
const counts = reactive({ photo: null, stories: null, talk: null });

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
// Как место из справочника называется сейчас.
const now = (text) => store.tree?.places?.find((x) => placeKey(x.title) === placeKey(text))?.now || '';
// «жена · брак 1945, с. Горки · развод 1962».
function bond(m) {
  const f = m.fam;
  const who = m.spouse.sex === 'F' ? 'жена' : 'муж';
  const start = f.start_date || f.place ? `${f.kind === 'partners' ? 'вместе с' : 'брак'} ${[dateText(f.start_date), f.place].filter(Boolean).join(', ')}` : '';
  return [who, start, f.ended === 'divorce' && `развод${f.end_date ? ` ${dateText(f.end_date)}` : ''}`].filter(Boolean).join(' · ');
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

const UNDO = 'Вернуть можно в «Ещё → Последние правки».';
async function removePerson() {
  if (!await ask({ text: `Удалить ${nameAccusative(p.value)} из дерева?`, note: `${fullName(p.value)}. ${UNDO}`, yes: 'Удалить', no: 'Не удалять', danger: true })) return;
  await api('DELETE', `/api/persons/${p.value.id}`);
  await loadTree();
  toast('Удалено. Отменить можно в «Ещё → Последние правки».');
  router.replace('/');
}

// Убрать мужа или жену (m.spouse) либо ребёнка (kid) из семьи m — с вопросом, где названы все по имени.
async function unlink(m, kid) {
  const short = (x) => x.given || fullName(x);
  const text = kid
    ? `Убрать ${nameAccusative(kid, true)} из детей ${[p.value, m.spouse].filter(Boolean).map((x) => nameGenitive(x, true)).join(' и ')}?`
    : `Убрать ${nameAccusative(m.spouse, true)} из семьи ${nameGenitive(p.value, true)}?`;
  const note = kid
    ? `${kid.sex === 'F' ? 'Сама' : 'Сам'} ${short(kid)} останется в дереве. ${UNDO}`
    : `${short(m.spouse)} и ${short(p.value)} больше не будут записаны ${m.fam.kind === 'partners' ? 'парой' : 'мужем и женой'}. Сами они и дети останутся в дереве. ${UNDO}`;
  if (!await ask({ text, note, yes: 'Убрать', no: 'Не убирать', danger: true })) return;
  try {
    await api('DELETE', `/api/families/${m.familyId}/members/${(kid || m.spouse).id}`);
    await loadTree();
    toast('Связь убрана');
  } catch (e) { toast(e.message); }
}

// Закладки под именем: переход к разделу карточки.
const tabs = computed(() => {
  const n = (x) => (x ? ` ${x}` : '');
  return [
    ['photo', `Фото${n(counts.photo)}`], ['family', 'Семья'], ['life', 'Жизнь'], ['stories', `Истории${n(counts.stories)}`],
    ['sources', `Источники${n(sources.value?.sources?.length)}`], ['talk', `Обсуждение${n(counts.talk)}`],
  ];
});
function jump(id) {
  document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const living = (sex, on) => (on ? (sex === 'F' ? 'Жива' : 'Жив') : (sex === 'F' ? 'Умерла' : 'Умер'));

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

watch(() => props.id, () => { editing.value = false; showHistory.value = false; linking.value = false; Object.assign(counts, { photo: null, stories: null, talk: null }); });
onUnmounted(onLive((events) => {
  if (!events.some((e) => e.kind === 'tree')) return;
  loadSources();
  if (showHistory.value) return reloadHistory();
}));
</script>

<template>
  <div class="page" v-if="!p"><p class="muted">{{ store.tree ? 'Человек не найден или удалён.' : 'Загрузка…' }}</p><router-link to="/">К дереву</router-link></div>
  <div class="page" v-else>
    <div class="row" style="margin-bottom:0.444rem">
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
      <div v-if="p.birth_surname && p.birth_surname !== p.surname" class="muted">{{ p.sex === 'F' ? 'урождённая' : 'урождённый' }} {{ p.birth_surname }}</div>
      <FactBadge v-if="!p.hidden" :info="info('person', p.id, 'name')" :editable="canEdit()" @open="sheet = { fact: fact('person', p.id, 'name') }" />
    </div>

    <nav v-if="!p.hidden && !editing" class="tabs" aria-label="Разделы карточки">
      <button v-for="[id, label] in tabs" :key="id" type="button" class="chip" @click="jump(id)">{{ label }}</button>
    </nav>

    <div v-if="missing.length && canEdit() && !editing" class="banner">Не хватает: {{ missing.join(', ') }}</div>

    <form v-if="editing" @submit.prevent="save" class="card">
      <div class="seg" style="margin-bottom:0.444rem">
        <button type="button" :class="{ on: form.sex === 'M' }" @click="form.sex = 'M'">Мужчина</button>
        <button type="button" :class="{ on: form.sex === 'F' }" @click="form.sex = 'F'">Женщина</button>
      </div>
      <div class="seg">
        <button type="button" :class="{ on: form.living }" @click="form.living = true">{{ living(form.sex, true) }}</button>
        <button type="button" :class="{ on: !form.living }" @click="form.living = false">{{ living(form.sex, false) }}</button>
      </div>
      <template v-for="[k, label] in FIELDS" :key="k">
        <template v-if="form.living ? !['death_date', 'death_place', 'burial_place'].includes(k) : true">
          <DateInput v-if="k.endsWith('_date')" v-model="form[k]" :label="label" placeholder="например: 12.03.1890, около 1890, до 1917" />
          <PlaceInput v-else-if="k.endsWith('_place')" v-model="form[k]" :label="label" placeholder="например: д. Горки" />
          <label v-else class="field">
            <span>{{ label }}</span>
            <textarea v-if="k === 'notes'" v-model="form[k]" />
            <input v-else v-model="form[k]" />
          </label>
        </template>
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
          <div class="label">{{ label }}</div>
          <router-link v-if="k.endsWith('_place')" :to="{ path: '/place', query: { text: p[k] } }" class="placelink">{{ p[k] }}</router-link>
          <div v-else class="pre">{{ k.endsWith('_date') ? dateText(p[k]) : p[k] }}</div>
          <div v-if="k.endsWith('_place') && now(p[k])" class="muted small">сейчас: {{ now(p[k]) }}</div>
          <FactBadge v-if="fact('person', p.id, k)" :info="info('person', p.id, k)" :editable="canEdit()" @open="sheet = { fact: fact('person', p.id, k) }" />
        </div>
      </template>
      <div v-if="p.hidden" class="muted">Даты, места и фото живых родственников видны только участникам дерева.</div>
      <div v-else-if="!FIELDS.some(([k]) => p[k] && !['surname', 'given', 'patronymic'].includes(k))" class="muted">Подробностей пока нет.</div>
    </div>

    <section id="sec-photo" class="sec"><Album ref="album" :person="p" @count="counts.photo = $event" /></section>

    <section id="sec-family" class="sec">
      <h2>Родители</h2>
      <div class="list">
        <router-link v-for="x in parents" :key="x.id" :to="`/person/${x.id}`">
          <div class="avatar" :class="x.sex">{{ (x.given || '?')[0] }}</div>
          <div class="grow"><div class="name">{{ fullName(x) }}</div><div class="muted small">{{ lifespan(x) }}</div></div>
        </router-link>
        <div v-if="canEdit() && parents.length < 2" class="add">
          <button v-if="!parents.some((x) => x.sex === 'M')" @click="openAdd({ to: p.id, type: 'father' })">+ Отец</button>
          <button v-if="!parents.some((x) => x.sex === 'F')" @click="openAdd({ to: p.id, type: 'mother' })">+ Мать</button>
        </div>
        <div v-else-if="!parents.length" class="muted">Не указаны</div>
      </div>

      <h2>Семья</h2>
      <div class="list">
        <template v-for="m in marriages" :key="m.familyId">
          <router-link v-if="m.spouse" :to="`/person/${m.spouse.id}`" class="kin">
            <div class="avatar" :class="m.spouse.sex">{{ (m.spouse.given || '?')[0] }}</div>
            <div class="grow">
              <div class="name">{{ fullName(m.spouse) }}</div><div class="muted small">{{ bond(m) }}</div>
              <FactBadge v-if="!linking && !m.spouse.hidden && !p.hidden" :info="info('family', m.familyId, 'marriage')" :editable="canEdit()"
                @open="sheet = { fact: fact('family', m.familyId, 'marriage') }" />
              <button v-if="linking" class="danger unlink" @click.prevent.stop="unlink(m)">Убрать связь</button>
            </div>
          </router-link>
          <button v-if="m.spouse && canEdit() && !linking" class="bond" @click="marriage = { family: m.fam, spouse: m.spouse }">
            <span class="grow">{{ m.fam.start_date || m.fam.place ? 'Изменить' : 'Указать' }} {{ m.fam.kind === 'partners' ? 'сведения о союзе' : 'дату и место брака' }}</span>
            <span aria-hidden="true">›</span>
          </button>
          <router-link v-for="c in m.kids" :key="c.id" :to="`/person/${c.id}`" class="kin kid">
            <div class="avatar" :class="c.sex">{{ (c.given || '?')[0] }}</div>
            <div class="grow">
              <div class="name">{{ fullName(c) }}</div><div class="muted small">{{ [c.sex === 'F' ? 'дочь' : 'сын', lifespan(c)].filter(Boolean).join(' · ') }}</div>
              <button v-if="linking" class="danger unlink" @click.prevent.stop="unlink(m, c)">Убрать связь</button>
            </div>
          </router-link>
        </template>
        <div v-if="!marriages.length" class="muted">Муж или жена и дети не указаны</div>
        <div v-if="canEdit() && linking" class="add">
          <p class="muted">Нажмите «Убрать связь» у того, кто записан в семью по ошибке. Сам человек останется в дереве.</p>
          <button class="primary" @click="linking = false">Готово</button>
        </div>
        <div v-else-if="canEdit()" class="add">
          <button @click="openAdd({ to: p.id, type: 'spouse' })">+ Муж или жена</button>
          <button @click="openAdd({ to: p.id, type: 'child' })">+ Ребёнок</button>
          <button v-if="marriages.some((m) => m.spouse || m.kids.length)" class="ghost wide" @click="linking = true">Убрать связь…</button>
        </div>
      </div>

      <h2>Братья и сёстры</h2>
      <div class="list">
        <router-link v-for="x in siblings" :key="x.id" :to="`/person/${x.id}`">
          <div class="avatar" :class="x.sex">{{ (x.given || '?')[0] }}</div>
          <div class="grow"><div class="name">{{ fullName(x) }}</div><div class="muted small">{{ lifespan(x) }}</div></div>
        </router-link>
        <div v-if="!siblings.length && !canEdit()" class="muted">Не указаны</div>
        <div v-if="canEdit()" class="add"><button @click="openAdd({ to: p.id, type: 'sibling' })">+ Брат или сестра</button></div>
      </div>
    </section>

    <section id="sec-life" class="sec"><Life :person="p" :sources="sources" @edit="startEdit(); scrollTo(0, 0)" @changed="loadSources" /></section>

    <section id="sec-stories" class="sec"><Stories :person="p" @count="counts.stories = $event" /></section>

    <section id="sec-sources" class="sec"><Sources :person="p" :data="sources" @cite="sheet = { fact: null }" @changed="loadSources" /></section>

    <section id="sec-talk" class="sec"><Discussion :person="p" @count="counts.talk = $event" /></section>

    <h2>Ещё</h2>
    <div class="list">
      <router-link :to="`/person/${p.id}/print`">Напечатать карточку</router-link>
      <a href="#" @click.prevent="showOnTree">Показать на дереве</a>
      <a href="#" v-if="store.me?.person_id !== p.id" @click.prevent="setMe">Это я</a>
      <a :href="`/api/print.pdf?root=${p.id}&mode=hourglass`" target="_blank">Распечатать дерево вокруг этого человека</a>
      <router-link :to="{ path: '/print', query: { root: p.id, mode: 'fan' } }">Веер предков</router-link>
      <router-link v-if="marriages.some((m) => m.kids.length)" :to="{ path: '/print', query: { root: p.id, mode: 'rospis' } }">Поколенная роспись</router-link>
      <a href="#" v-if="canTalk()" @click.prevent="loadHistory">История правок</a>
      <a href="#" v-if="canEdit()" class="danger-link" @click.prevent="removePerson">Удалить из дерева</a>
    </div>

    <FactSheet v-if="sheet" :key="sheet.fact ? sheet.fact.subject + sheet.fact.id + sheet.fact.fact : 'pick'" :fact="sheet.fact" :facts="facts"
      :data="sources" :person="p" @close="sheet = null" @changed="loadSources" />

    <MarriageSheet v-if="marriage" :family="marriage.family" :spouse="marriage.spouse" @close="marriage = null" />

    <ChangeList v-if="showHistory" :ops="history" style="margin-top:0.556rem" @reverted="reloadHistory" />
  </div>
</template>

<style scoped>
.head { text-align: center; margin: 0.222rem 0 0.889rem; }
.head h1 { margin: 0.667rem 0 0.222rem; overflow-wrap: anywhere; }
.photo { width: 8rem; height: 8rem; border-radius: 1.556rem; margin: 0 auto; overflow: hidden; display: grid; place-items: center; background: var(--line); color: var(--muted); font-size: 1rem; cursor: pointer; }
.photo.M { background: var(--male-soft); color: var(--male); }
.photo.F { background: var(--female-soft); color: var(--female); }
.photo img { width: 100%; height: 100%; object-fit: cover; }
.tabs { display: flex; flex-wrap: wrap; gap: 0.444rem; margin: 0 0 1rem; }
.tabs .chip { flex: 1 1 auto; font-size: 1rem; font-weight: 700; color: var(--accent-text); }
.sec { scroll-margin-top: 0.5rem; }
.list > .fact { display: block; }
.fact .label { font-size: 0.889rem; font-weight: 700; }
.pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.placelink { color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; overflow-wrap: anywhere; }
.name { overflow-wrap: anywhere; }
.kin { align-items: flex-start !important; }
.kin .avatar { margin-top: 0.111rem; }
.kid { padding-left: 1.778rem !important; }
.unlink { margin-top: 0.444rem; min-height: 2.667rem; font-size: 0.889rem; }
.list > .bond { padding-left: 4.333rem; color: var(--accent-text); font-weight: 700; font-size: 0.889rem; min-height: 3rem; }
.add { display: flex !important; flex-wrap: wrap; gap: 0.5rem; }
.add > button { flex: 1 1 auto; }
.add > .wide, .add > p { flex-basis: 100%; margin: 0; }
.danger-link { color: var(--danger) !important; }
</style>
