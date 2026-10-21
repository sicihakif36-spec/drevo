<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { store, canEdit } from '../store.js';
import { placeKey } from '@shared/places.js';
import PlaceForm from '../components/PlaceForm.vue';

// Справочник мест: старое деление и как это сейчас. Нажатие — карточка места.
const router = useRouter();
const query = ref('');
const adding = ref(false);
const places = computed(() => {
  const words = placeKey(query.value).split(' ').filter(Boolean);
  return (store.tree?.places || []).filter((x) => words.every((w) => placeKey(`${x.title} ${x.now}`).includes(w)));
});
function saved(x) {
  adding.value = false;
  router.push({ path: '/place', query: { id: x.id } });
}
</script>

<template>
  <div class="page">
    <div class="row" style="margin-bottom:8px">
      <button class="ghost" @click="router.back()" aria-label="Назад">‹ Назад</button>
    </div>
    <h1>Места</h1>
    <p class="muted small">Деревни, сёла и города по старому делению — волость, уезд, губерния — и как они называются сейчас.
      Когда пишете место в карточке, они подсказываются сами.</p>
    <input v-if="(store.tree?.places || []).length > 5" v-model="query" type="search" placeholder="Поиск" style="margin-bottom:10px" />
    <div class="list">
      <router-link v-for="x in places" :key="x.id" :to="{ path: '/place', query: { id: x.id } }">
        <div class="grow"><div>{{ x.title }}</div><div v-if="x.now" class="muted small">сейчас: {{ x.now }}</div></div>
        <span class="muted">›</span>
      </router-link>
      <div v-if="!places.length" class="muted">{{ query ? 'Ничего не нашлось' : 'Справочник пока пуст' }}</div>
    </div>
    <button v-if="canEdit()" class="primary block" style="margin-top:12px" @click="adding = true">+ Добавить место</button>
    <PlaceForm v-if="adding" @close="adding = false" @saved="saved" />
  </div>
</template>
