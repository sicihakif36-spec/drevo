<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { store, loadTree, toast } from '../store.js';
import { api } from '../api.js';
import { addState, closeAdd } from './addState.js';
import DateInput from './DateInput.vue';
import PlaceInput from './PlaceInput.vue';
import { fullName, nameGenitive, lifespan, patronymicFrom, surnameFor, guessSex, parentsOf, spousesOf, personHas, sameName } from '@shared/names.js';

const emit = defineEmits(['done']);
const REL = [
  ['father', 'Отец'], ['mother', 'Мать'], ['spouse', 'Муж или жена'],
  ['child', 'Ребёнок'], ['sibling', 'Брат или сестра'],
];

const idx = computed(() => store.idx);
const first = !store.tree?.persons.length;
const to = ref(addState.relation?.to || null);
const type = ref(first ? 'self' : addState.relation?.type || null);
const target = computed(() => idx.value?.persons.get(to.value));
const familyId = ref(null);
const sexTouched = ref(false);
const saving = ref(false);
const error = ref('');

const f = reactive({ surname: '', given: '', patronymic: '', sex: 'U', living: true, birth_date: '', death_date: '', birth_place: '' });

// Семьи цели, если добавляем ребёнка: выбрать второго родителя.
const families = computed(() => (type.value === 'child' && target.value ? spousesOf(idx.value, to.value) : []));

function father() {
  // Отец нового человека — чтобы подставить фамилию и отчество.
  const t = target.value;
  if (!t) return null;
  if (type.value === 'child') {
    if (t.sex === 'M') return t;
    const fam = idx.value.families.get(familyId.value);
    const other = fam && (fam.partner1 === t.id ? fam.partner2 : fam.partner1);
    return other ? idx.value.persons.get(other) : null;
  }
  if (type.value === 'sibling') {
    return parentsOf(idx.value, t.id).map((id) => idx.value.persons.get(id)).find((p) => p?.sex === 'M') || null;
  }
  return null;
}

function prefill() {
  error.value = '';
  sexTouched.value = false;
  Object.assign(f, { surname: '', given: '', patronymic: '', sex: 'U', living: true, birth_date: '', death_date: '', birth_place: '' });
  const t = target.value;
  if (type.value === 'father') { f.sex = 'M'; f.surname = t ? surnameFor(t.surname, 'M') : ''; sexTouched.value = true; }
  if (type.value === 'mother') { f.sex = 'F'; sexTouched.value = true; }
  if (type.value === 'spouse' && t) { f.sex = t.sex === 'M' ? 'F' : t.sex === 'F' ? 'M' : 'U'; }
  if (type.value === 'child' || type.value === 'sibling') {
    const fa = father();
    if (fa) f.surname = fa.surname;
    else if (t && type.value === 'sibling') f.surname = t.surname;
  }
  if (['father', 'mother'].includes(type.value) && t?.birth_date) f.living = !(Number(t.birth_date.match(/\d{4}/)?.[0]) < 1950);
}
watch([type, to], prefill, { immediate: true });
watch(families, (fs) => { if (fs.length === 1) familyId.value = fs[0].familyId; }, { immediate: true });
watch(familyId, () => { if (type.value === 'child') { const fa = father(); if (fa) { f.surname = surnameFor(fa.surname, f.sex); f.patronymic = patronymicFrom(fa.given, f.sex); } } });

// Род угадываем по имени и отчеству, пока человек не выбрал вручную.
watch(() => [f.given, f.patronymic], () => {
  if (!sexTouched.value && (f.given || f.patronymic)) f.sex = guessSex(f.given, f.patronymic);
});
watch(() => f.sex, (sex, old) => {
  const fa = father();
  if (fa && (type.value === 'child' || type.value === 'sibling')) {
    f.patronymic = patronymicFrom(fa.given, sex);
    f.surname = surnameFor(fa.surname, sex);
  } else if (old && f.surname) {
    f.surname = surnameFor(f.surname, sex);
  }
});
watch(() => f.given, () => {
  const fa = father();
  if (fa && !f.patronymic) f.patronymic = patronymicFrom(fa.given, f.sex);
});

function setSex(s) { f.sex = s; sexTouched.value = true; }

const duplicates = computed(() => {
  if (!f.given || !idx.value) return [];
  // Без различий татарских и русских букв и похожих написаний: «Ринат» найдёт «Рената».
  const s = f.surname.trim();
  return [...idx.value.persons.values()].filter((p) => sameName(p.given, f.given) && (!s || sameName(p.surname, s) || sameName(p.birth_surname, s)) && p.id !== to.value).slice(0, 3);
});

const title = computed(() => {
  if (type.value === 'self') return 'Начнём с вас';
  // Когда пол уже ясен — «Жена», «Брат», а не «Муж или жена».
  const bySex = { spouse: { M: 'Муж', F: 'Жена' }, sibling: { M: 'Брат', F: 'Сестра' }, child: { M: 'Сын', F: 'Дочь' } };
  if (bySex[type.value]?.[f.sex]) return bySex[type.value][f.sex];
  const r = REL.find((x) => x[0] === type.value);
  return r ? r[1] : 'Кого добавить?';
});

async function save(existingId) {
  if (!existingId && !f.given.trim() && !f.surname.trim()) { error.value = 'Укажите хотя бы имя'; return; }
  saving.value = true;
  error.value = '';
  try {
    const relation = type.value === 'self' ? null : { to: to.value, type: type.value, familyId: familyId.value || undefined };
    const person = { ...f, death_date: f.living ? '' : f.death_date };
    const p = await api('POST', '/api/persons', existingId ? { existingId, relation } : { person, relation });
    if (type.value === 'self') await api('PATCH', '/api/me', { person_id: p.id });
    await loadTree();
    toast(existingId ? 'Связь добавлена' : `${p.given || p.surname} в дереве`);
    closeAdd();
    emit('done', type.value === 'self' ? null : p.id);
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

const pickTarget = ref('');
const candidates = computed(() => {
  const s = pickTarget.value.trim();
  const all = [...(idx.value?.persons.values() || [])];
  return (s ? all.filter((p) => personHas(p, s)) : all).slice(0, 8);
});
</script>

<template>
  <div class="sheet-backdrop" @click="closeAdd" />
  <div class="sheet" role="dialog" aria-modal="true">
    <div class="row"><h1 class="grow">{{ title }}</h1><button class="ghost" @click="closeAdd" aria-label="Закрыть">✕</button></div>
    <p class="muted" v-if="target && type" style="margin-top:-0.5rem">Родственник для: {{ fullName(target) }}</p>

    <template v-if="!to && type !== 'self'">
      <p class="muted">Кому добавляем родственника?</p>
      <input v-model="pickTarget" placeholder="Начните вводить имя" />
      <div class="list" style="margin-top:8px">
        <a v-for="p in candidates" :key="p.id" href="#" @click.prevent="to = p.id">{{ fullName(p) }} <span class="muted small">{{ lifespan(p) }}</span></a>
      </div>
    </template>

    <template v-else-if="!type">
      <p class="who">Кто это для {{ nameGenitive(target) }}?</p>
      <div class="grid2 rel">
        <button v-for="[k, label] in REL" :key="k" @click="type = k">{{ label }}</button>
      </div>
    </template>

    <form v-else @submit.prevent="save()">
      <div v-if="families.length > 1" class="field">
        <span class="muted small">Второй родитель</span>
        <div class="chips wrap" style="margin-top:4px">
          <button type="button" v-for="fam in families" :key="fam.familyId" class="chip" :class="{ on: familyId === fam.familyId }" @click="familyId = fam.familyId">
            {{ fam.spouseId ? fullName(idx.persons.get(fam.spouseId)) : 'не указан' }}
          </button>
        </div>
      </div>
      <label class="field"><span>Имя</span><input v-model="f.given" autocomplete="off" autocapitalize="words" autofocus /></label>
      <label class="field"><span>Отчество</span><input v-model="f.patronymic" autocomplete="off" autocapitalize="words" /></label>
      <label class="field"><span>Фамилия</span><input v-model="f.surname" autocomplete="off" autocapitalize="words" /></label>
      <div class="field">
        <div class="seg">
          <button type="button" :class="{ on: f.sex === 'M' }" @click="setSex('M')">Мужчина</button>
          <button type="button" :class="{ on: f.sex === 'F' }" @click="setSex('F')">Женщина</button>
        </div>
      </div>
      <div class="field">
        <div class="seg">
          <button type="button" :class="{ on: f.living }" @click="f.living = true">{{ f.sex === 'F' ? 'Жива' : 'Жив' }}</button>
          <button type="button" :class="{ on: !f.living }" @click="f.living = false">{{ f.sex === 'F' ? 'Умерла' : 'Умер' }}</button>
        </div>
      </div>
      <div>
        <DateInput v-model="f.birth_date" label="Рождение" placeholder="1950 или около 1890" />
        <DateInput v-if="!f.living" v-model="f.death_date" label="Смерть" placeholder="год или дата" />
      </div>
      <PlaceInput v-model="f.birth_place" label="Место рождения" placeholder="Город, село" />

      <div v-if="duplicates.length && type !== 'self'" class="banner">
        Похоже, этот человек уже есть в дереве:
        <div v-for="d in duplicates" :key="d.id" class="row" style="margin-top:6px">
          <span class="grow">{{ fullName(d) }} <span class="small">{{ lifespan(d) }}</span></span>
          <button type="button" @click="save(d.id)" :disabled="saving">{{ d.sex === 'F' ? 'Это она' : d.sex === 'M' ? 'Это он' : 'Это тот же человек' }}</button>
        </div>
      </div>
      <p class="error" v-if="error">{{ error }}</p>
      <button class="primary block" :disabled="saving">{{ saving ? 'Сохраняю…' : 'Добавить' }}</button>
      <p class="muted small">Остальное (фото, даты, заметки) можно дописать позже в карточке.</p>
    </form>
  </div>
</template>

<style scoped>
.who { font-size: 1.111rem; font-weight: 700; margin: 0.5rem 0 0.667rem; }
.rel button { min-height: 3.333rem; }
</style>
