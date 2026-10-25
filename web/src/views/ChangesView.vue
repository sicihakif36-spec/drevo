<script setup>
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';
import { canEdit } from '../store.js';
import ChangeList from '../components/ChangeList.vue';

// ?op=<действие> — только оно (ссылка из журнала поиска: что загружено из ответа помощника).
const route = useRoute();
const ops = ref([]);
const loaded = ref(false);
const load = async () => {
  const op = route.query.op;
  ops.value = await api('GET', op ? `/api/changes?op=${encodeURIComponent(op)}` : '/api/changes');
  loaded.value = true;
};
onMounted(load);
watch(() => route.query.op, load);
</script>

<template>
  <div class="page">
    <h1>Последние правки</h1>
    <p class="muted small" v-if="canEdit()">Любое действие можно отменить, а отменённое вернуть.</p>
    <ChangeList v-if="loaded" :ops="ops" @reverted="load" />
    <div v-else class="muted">Загрузка…</div>
    <router-link v-if="route.query.op" to="/changes" class="btn block" style="margin-top:0.667rem">Все правки</router-link>
  </div>
</template>
