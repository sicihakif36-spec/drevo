<script setup>
import { computed, ref } from 'vue';
import { store } from '../store.js';
import { photoUrl } from '../api.js';
import { fullName, lifespan, missingFields } from '@shared/names.js';

const query = ref('');
const filter = ref('all');
const FILTERS = [['all', 'Все'], ['nophoto', 'Без фото'], ['nodates', 'Без дат'], ['noparents', 'Без родителей'], ['living', 'Живые'], ['dead', 'Ушедшие']];

const people = computed(() => {
  if (!store.idx) return [];
  const s = query.value.trim().toLowerCase();
  return [...store.idx.persons.values()]
    .filter((p) => !s || fullName(p).toLowerCase().includes(s) || p.birth_surname.toLowerCase().includes(s) || p.birth_place.toLowerCase().includes(s))
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
  <div class="page">
    <h1>Люди <span class="muted small">{{ store.tree?.persons.length || 0 }}</span></h1>
    <input v-model="query" placeholder="Поиск по имени, фамилии, месту" />
    <div class="chips" style="margin:10px 0">
      <button v-for="[k, label] in FILTERS" :key="k" class="chip" :class="{ on: filter === k }" @click="filter = k">{{ label }}</button>
    </div>
    <div class="list">
      <router-link v-for="p in people" :key="p.id" :to="`/person/${p.id}`">
        <img v-if="p.photo_id" :src="photoUrl(p.photo_id)" class="avatar" alt="" loading="lazy" />
        <div v-else class="avatar" :class="p.sex">{{ (p.given || p.surname || '?')[0] }}</div>
        <div class="grow">
          <div class="ellipsis">{{ fullName(p) }}</div>
          <div class="muted small ellipsis">{{ [lifespan(p), p.birth_place].filter(Boolean).join(' · ') }}</div>
        </div>
      </router-link>
      <div v-if="!people.length" class="muted">Никого не нашлось</div>
    </div>
  </div>
</template>
