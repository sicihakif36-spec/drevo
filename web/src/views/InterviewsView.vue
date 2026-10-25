<script setup>
import { computed, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { store, onLive } from '../store.js';
import { api } from '../api.js';
import { ivTitle } from '@shared/interview.js';

// «Ещё → Интервью»: незаконченные и сохранённые интервью, которые мне видны (свои, а владельцу и участникам — все).
const router = useRouter();
const items = ref([]);
const loaded = ref(false);
const error = ref('');

async function load() {
  try {
    items.value = await api('GET', '/api/interviews');
    loaded.value = true;
  } catch (e) { error.value = e.message; }
}
load();
onUnmounted(onLive((events) => { if (events.some((e) => e.kind === 'interviews' || e.kind === 'tree')) return load(); }));

const drafts = computed(() => items.value.filter((x) => !x.saved));
const saved = computed(() => items.value.filter((x) => x.saved));
const who = (x) => {
  const p = store.idx?.persons.get(x.person_id);
  return p ? [p.surname, p.given, p.patronymic].filter(Boolean).join(' ') : x.about;
};
const line = (x) => [ivTitle(x.created_at), `${x.answered} из ${x.total} ответов`, x.by_name && `начал(а) ${x.by_name}`,
  x.link && `по ссылке${x.to_name ? ` (${x.to_name})` : ''}`].filter(Boolean).join(' · ');
</script>

<template>
  <div class="page">
    <div class="row" style="margin-bottom:0.444rem"><button class="ghost" @click="router.back()">‹ Назад</button></div>
    <h1>Интервью</h1>
    <p class="muted">Чтобы записать воспоминания, откройте карточку человека и нажмите «Записать воспоминания» в разделе «Истории».</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!loaded" class="muted">Загрузка…</p>

    <template v-if="drafts.length">
      <h2>Незаконченные</h2>
      <div class="list">
        <router-link v-for="x in drafts" :key="x.id" :to="`/interview/${x.id}`">
          <span class="grow"><span class="name">{{ who(x) }}</span><span class="muted small">{{ line(x) }}</span></span>
          <span class="btn primary go">Продолжить</span>
        </router-link>
      </div>
    </template>
    <template v-if="saved.length">
      <h2>Сохранены в истории</h2>
      <div class="list">
        <router-link v-for="x in saved" :key="x.id" :to="{ path: `/person/${x.person_id}`, hash: '#sec-stories' }">
          <span class="grow"><span class="name">{{ who(x) }}</span><span class="muted small">{{ line(x) }}</span></span>
          <span class="muted">›</span>
        </router-link>
      </div>
    </template>
    <p v-if="loaded && !items.length" class="muted">Интервью пока нет.</p>
  </div>
</template>

<style scoped>
.grow > span { display: block; }
.name { font-weight: 700; overflow-wrap: anywhere; }
.go { min-height: 2.667rem; padding: 0.25rem 0.778rem; font-size: 0.889rem; }
</style>
