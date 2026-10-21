<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api.js';
import { canEdit } from '../store.js';
import ChangeList from '../components/ChangeList.vue';

const ops = ref([]);
const loaded = ref(false);
const load = async () => {
  ops.value = await api('GET', '/api/changes');
  loaded.value = true;
};
onMounted(load);
</script>

<template>
  <div class="page">
    <h1>Последние правки</h1>
    <p class="muted small" v-if="canEdit()">Любое действие можно отменить, а отменённое вернуть.</p>
    <ChangeList v-if="loaded" :ops="ops" @reverted="load" />
    <div v-else class="muted">Загрузка…</div>
  </div>
</template>
