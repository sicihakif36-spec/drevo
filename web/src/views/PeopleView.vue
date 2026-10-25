<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store } from '../store.js';
import { photoUrl } from '../api.js';
import { fullName, lifespan, missingFields, personHas, textHas, altName } from '@shared/names.js';

const route = useRoute();
const router = useRouter();
const query = ref('');
const FILTERS = [['all', 'Все'], ['nophoto', 'Без фото'], ['nodates', 'Без дат'], ['noparents', 'Без родителей'], ['living', 'Живые'], ['dead', 'Ушедшие']];
// Фильтр живёт в адресе (/people?f=nophoto): на него ведут подсказки в ленте.
const filter = computed(() => (FILTERS.some(([k]) => k === route.query.f) ? route.query.f : 'all'));
const setFilter = (k) => router.replace({ query: k === 'all' ? {} : { f: k } });
// Пришли по подсказке: выбранный фильтр может оказаться за краем экрана.
onMounted(() => document.querySelector('.chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }));

const people = computed(() => {
  if (!store.idx) return [];
  const s = query.value.trim();
  return [...store.idx.persons.values()]
    .filter((p) => !s || personHas(p, s) || textHas(p.birth_place, s))
    .filter((p) => {
      if (filter.value === 'nophoto') return !p.photo_id;
      if (filter.value === 'nodates') return !p.birth_date;
      if (filter.value === 'noparents') return missingFields(p, store.idx).includes('родители');
      if (filter.value === 'living') return p.living;
      if (filter.value === 'dead') return !p.living;
      return true;
    })
    .sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru'));
});
</script>

<template>
  <div class="page wide">
    <h1>Люди <span class="muted count">{{ store.tree?.persons.length || 0 }}</span></h1>
    <div class="filters">
      <label class="field"><span>Найти по имени, фамилии или месту</span><input v-model="query" type="search" placeholder="Например: Смирнов" /></label>
      <div class="chips">
        <button v-for="[k, label] in FILTERS" :key="k" class="chip" :class="{ on: filter === k }" @click="setFilter(k)">{{ label }}</button>
      </div>
    </div>
    <!-- На компьютере — сеткой карточек. -->
    <div class="list people">
      <router-link v-for="p in people" :key="p.id" :to="`/person/${p.id}`">
        <img v-if="p.photo_id" :src="photoUrl(p.photo_id)" class="avatar" alt="" loading="lazy" />
        <div v-else class="avatar" :class="p.sex">{{ (p.given || p.surname || '?')[0] }}</div>
        <div class="grow">
          <div class="name">{{ fullName(p) }}</div>
          <div class="muted small name">{{ [altName(p), lifespan(p), p.birth_place].filter(Boolean).join(' · ') }}</div>
        </div>
      </router-link>
      <div v-if="!people.length" class="muted">{{ query.trim() ? 'Никого не нашлось. Попробуйте только фамилию' : 'Никого нет' }}</div>
    </div>
  </div>
</template>

<style scoped>
.name { overflow-wrap: anywhere; }
.count { font-weight: 400; }
.chips { margin: 0.556rem 0; }
@media (min-width: 64em) {
  .filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.444rem 1.111rem; margin-bottom: 1.111rem; }
  .filters .field { flex: 1 1 20rem; margin: 0; }
  .filters .chips { margin: 0; }
  .people { display: grid; grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr)); gap: 0.667rem; background: transparent; border: 0; border-radius: 0; overflow: visible; }
  .people > * { border: 1px solid var(--line); border-radius: var(--radius); background: var(--card); min-height: 4.667rem; }
  .people > .muted { grid-column: 1 / -1; }
  .people .small { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
}
</style>
