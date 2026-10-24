<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { store, canEdit, loadTree, toast } from '../store.js';
import { api, photoUrl } from '../api.js';
import { FIELDS } from '../history.js';
import { ask } from '../components/ask.js';
import { fullName, lifespan, dateText, parentsOf, spousesOf, childrenOf, siblingsOf } from '@shared/names.js';
import { MERGE_FIELDS, defaultChoice, mergedPerson } from '@shared/checks.js';

// «Это один человек → Объединить»: две карточки рядом, по каждому полю — что оставить, предпросмотр, объединение.
// Остаётся карточка, у которой больше родных и сведений (её адрес и связи не меняются), вторая переносится в неё.
const props = defineProps({ a: String, b: String });
const router = useRouter();
const step = ref('choose');
const busy = ref(false);
const scrollTo = (x, y) => window.scrollTo(x, y);
const idx = computed(() => store.idx);

const kinOf = (id) => (idx.value ? {
  parents: parentsOf(idx.value, id), spouses: spousesOf(idx.value, id).map((s) => s.spouseId).filter(Boolean),
  children: childrenOf(idx.value, id), siblings: siblingsOf(idx.value, id),
} : null);
const weight = (p) => {
  const k = kinOf(p.id);
  return k.parents.length + k.spouses.length + k.children.length + k.siblings.length + (p.photo_id ? 1 : 0)
    + MERGE_FIELDS.filter((f) => typeof p[f] === 'string' && p[f]).length / 100;
};
const pair = computed(() => {
  const x = idx.value?.persons.get(props.a);
  const y = idx.value?.persons.get(props.b);
  if (!x || !y) return null;
  return weight(y) > weight(x) ? [y, x] : [x, y];
});
const keep = computed(() => pair.value?.[0]);
const remove = computed(() => pair.value?.[1]);

const choice = reactive({});
const photo = ref('keep');
watch(pair, (v) => {
  if (!v || Object.keys(choice).length) return;
  Object.assign(choice, defaultChoice(v[0], v[1]));
  photo.value = !v[0].photo_id && v[1].photo_id ? 'remove' : 'keep';
}, { immediate: true });

const LABEL = Object.fromEntries([...FIELDS, ['sex', 'Пол'], ['living', 'Жив или умер']]);
const ORDER = ['surname', 'given', 'patronymic', 'birth_surname', 'sex', 'living', 'birth_date', 'birth_place', 'death_date', 'death_place', 'burial_place', 'occupation', 'notes'];
function show(f, p) {
  const v = p[f];
  if (f === 'sex') return { M: 'Мужчина', F: 'Женщина' }[v] || 'Не указан';
  if (f === 'living') return v ? (p.sex === 'F' ? 'Жива' : 'Жив') : (p.sex === 'F' ? 'Умерла' : 'Умер');
  if (!v) return '';
  return f.endsWith('_date') ? dateText(v) : v;
}
// Поля, где карточки расходятся (одна пустая или значения разные), и где совпадают.
const differ = computed(() => (pair.value ? ORDER.filter((f) => keep.value[f] !== remove.value[f]) : []));
const same = computed(() => (pair.value ? ORDER.filter((f) => keep.value[f] === remove.value[f] && show(f, keep.value) && f !== 'living' && f !== 'sex') : []));
const twoPhotos = computed(() => keep.value?.photo_id && remove.value?.photo_id && keep.value.photo_id !== remove.value.photo_id);

// Родные обеих карточек: кто откуда (1 — первая, 2 — вторая, обе).
const KIN = [['parents', 'Родители'], ['spouses', 'Муж или жена'], ['children', 'Дети'], ['siblings', 'Братья и сёстры']];
const kin = computed(() => {
  if (!pair.value) return [];
  const a = kinOf(keep.value.id);
  const b = kinOf(remove.value.id);
  return KIN.map(([k, label]) => {
    const ids = [...new Set([...a[k], ...b[k]])].filter((id) => id !== keep.value.id && id !== remove.value.id);
    return { k, label, people: ids.map((id) => ({ p: idx.value.persons.get(id), from: a[k].includes(id) && b[k].includes(id) ? 'обе' : a[k].includes(id) ? '1' : '2' })).filter((x) => x.p) };
  }).filter((g) => g.people.length);
});
const result = computed(() => (pair.value ? mergedPerson(keep.value, remove.value, choice) : null));
const resultPhoto = computed(() => (photo.value === 'remove' && remove.value?.photo_id ? remove.value.photo_id : keep.value?.photo_id));
const tooMany = computed(() => kin.value.find((g) => g.k === 'parents')?.people.length > 2);

async function merge() {
  const ok = await ask({
    text: 'Объединить карточки?',
    note: `Останется одна карточка: ${fullName(result.value)}. Отменить можно в «Ещё → Последние правки».`,
    yes: 'Объединить',
    no: 'Не сейчас',
  });
  if (!ok) return;
  busy.value = true;
  try {
    const res = await api('POST', '/api/merge', {
      keep: keep.value.id, remove: remove.value.id, choice: { ...choice }, photo: photo.value,
      versions: { keep: keep.value.version, remove: remove.value.version },
    });
    await loadTree();
    toast('Объединено. Отменить можно в «Ещё → Последние правки».');
    router.replace(`/person/${res.id}`);
  } catch (e) {
    toast(e.message);
    if (e.status === 409) await loadTree();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page" v-if="!canEdit()"><p class="muted">Объединять карточки могут владелец и участники.</p></div>
  <div class="page" v-else-if="!pair">
    <p class="muted">{{ store.tree ? 'Одной из карточек уже нет в дереве — возможно, их уже объединили.' : 'Загрузка…' }}</p>
    <router-link to="/checks">К проверке дерева</router-link>
  </div>
  <div class="page" v-else>
    <div class="row" style="margin-bottom:0.444rem">
      <button class="ghost" @click="step === 'preview' ? (step = 'choose') : router.back()" aria-label="Назад">‹ Назад</button>
    </div>
    <h1>{{ step === 'choose' ? 'Это один человек?' : 'Что получится' }}</h1>

    <template v-if="step === 'choose'">
      <p class="muted lead">Сравните карточки и выберите, что оставить. Фото, истории, источники и обсуждение обеих карточек сохранятся.</p>
      <div class="grid2">
        <router-link v-for="(p, i) in pair" :key="p.id" :to="`/person/${p.id}`" class="card who">
          <img v-if="p.photo_id" :src="photoUrl(p.photo_id)" class="avatar" alt="" />
          <div v-else class="avatar" :class="p.sex">{{ (p.given || '?')[0] }}</div>
          <div class="num">Карточка {{ i + 1 }}</div>
          <div class="name">{{ fullName(p) }}</div>
          <div class="muted small">{{ lifespan(p) }}</div>
        </router-link>
      </div>

      <h2>Где различаются</h2>
      <p v-if="!differ.length && !twoPhotos" class="muted">Ничем — карточки одинаковые.</p>
      <div v-for="f in differ" :key="f" class="field-pick">
        <div class="label">{{ LABEL[f] }}</div>
        <div class="opts">
          <button v-for="(p, i) in pair" :key="p.id" type="button" class="opt" :class="{ on: choice[f] === (i ? 'remove' : 'keep') }"
            :aria-pressed="choice[f] === (i ? 'remove' : 'keep')" @click="choice[f] = i ? 'remove' : 'keep'">
            <span class="tag">{{ i + 1 }}</span><span class="val">{{ show(f, p) || '— пусто' }}</span>
          </button>
          <button v-if="f === 'notes' && keep.notes && remove.notes" type="button" class="opt" :class="{ on: choice.notes === 'both' }"
            :aria-pressed="choice.notes === 'both'" @click="choice.notes = 'both'">
            <span class="tag">1+2</span><span class="val">Оставить обе заметки</span>
          </button>
        </div>
      </div>
      <div v-if="twoPhotos" class="field-pick">
        <div class="label">Главное фото</div>
        <div class="opts photos">
          <button v-for="(p, i) in pair" :key="p.id" type="button" class="opt" :class="{ on: photo === (i ? 'remove' : 'keep') }"
            :aria-pressed="photo === (i ? 'remove' : 'keep')" @click="photo = i ? 'remove' : 'keep'">
            <span class="tag">{{ i + 1 }}</span><img :src="photoUrl(p.photo_id)" alt="" />
          </button>
        </div>
        <p class="small muted">Второе фото останется в альбоме.</p>
      </div>
      <p v-if="same.length" class="small muted">Совпадает: {{ same.map((f) => LABEL[f].toLowerCase()).join(', ') }}.</p>

      <template v-if="kin.length">
        <h2>Родные</h2>
        <div class="list">
          <div v-for="g in kin" :key="g.k" class="kin">
            <div class="label">{{ g.label }}</div>
            <div v-for="x in g.people" :key="x.p.id" class="kin-row">
              <span class="grow">{{ fullName(x.p) }}</span><span class="tag">{{ x.from }}</span>
            </div>
          </div>
        </div>
      </template>

      <button class="primary block go" @click="step = 'preview'; scrollTo(0, 0)">Посмотреть, что получится</button>
    </template>

    <template v-else>
      <div class="card result">
        <div class="head">
          <img v-if="resultPhoto" :src="photoUrl(resultPhoto)" class="avatar big" alt="" />
          <div v-else class="avatar big" :class="result.sex">{{ (result.given || '?')[0] }}</div>
          <div class="grow">
            <div class="name">{{ fullName(result) }}</div>
            <div class="muted">{{ lifespan(result) }}</div>
          </div>
        </div>
        <template v-for="f in ORDER" :key="f">
          <div v-if="show(f, result) && !['surname', 'given', 'patronymic', 'sex'].includes(f)" class="fact">
            <div class="label">{{ LABEL[f] }}</div>
            <div class="pre">{{ show(f, result) }}</div>
          </div>
        </template>
        <div v-for="g in kin" :key="g.k" class="fact">
          <div class="label">{{ g.label }}</div>
          <div>{{ g.people.map((x) => fullName(x.p)).join(', ') }}</div>
        </div>
      </div>
      <div v-if="tooMany" class="banner">У карточек записаны разные родители — после объединения их будет больше двух. Потом уберите лишнюю связь в карточке.</div>
      <p class="small">Всё со второй карточки — фото, документы, истории, события, источники, обсуждение, вопросы поиска — перейдёт сюда.
        Вторая карточка исчезнет из дерева. Отменить объединение можно одной кнопкой в «Ещё → Последние правки».</p>
      <button class="primary block" :disabled="busy" @click="merge">{{ busy ? 'Объединяю…' : 'Объединить' }}</button>
      <button class="block back" @click="step = 'choose'">Изменить выбор</button>
    </template>
  </div>
</template>

<style scoped>
.lead { margin-top: 0; }
.who { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.222rem; color: inherit; text-decoration: none; padding: 0.667rem; }
.who .avatar { width: 3.556rem; height: 3.556rem; }
.num { font-size: 0.778rem; font-weight: 700; color: var(--accent-text); text-transform: uppercase; letter-spacing: 0.04em; }
.name { font-weight: 700; overflow-wrap: anywhere; }
.field-pick { margin: 0.889rem 0; }
.label { font-size: 0.889rem; font-weight: 700; margin-bottom: 0.25rem; }
.opts { display: grid; gap: 0.444rem; }
.opt { justify-content: flex-start; text-align: left; font-weight: 400; color: var(--text); border-color: var(--line); gap: 0.556rem; }
.opt.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-soft-text); font-weight: 700; }
.opt .val { overflow-wrap: anywhere; white-space: pre-wrap; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.tag { flex: none; min-width: 1.556rem; padding: 0 0.333rem; height: 1.556rem; border-radius: 999px; background: var(--line); color: var(--text); font-size: 0.778rem; font-weight: 700; display: inline-grid; place-items: center; }
.opt.on .tag { background: var(--accent); color: var(--on-accent); }
.photos { grid-template-columns: 1fr 1fr; }
.photos img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 0.556rem; }
.photos .opt { flex-direction: column; align-items: stretch; padding: 0.444rem; }
.list > .kin { display: block; }
.kin-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.222rem 0; overflow-wrap: anywhere; }
.go { margin-top: 1.333rem; }
.result .head { display: flex; align-items: center; gap: 0.889rem; margin-bottom: 0.444rem; }
.avatar.big { width: 4.444rem; height: 4.444rem; }
.result .name { font-size: 1.222rem; }
.fact { padding: 0.444rem 0; border-top: 1px solid var(--line); }
.pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.banner { margin-top: 0.667rem; }
.back { margin-top: 0.5rem; }
</style>
