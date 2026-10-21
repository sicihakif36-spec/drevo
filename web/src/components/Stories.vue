<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { canEdit, onLive } from '../store.js';
import { api } from '../api.js';
import StoryView from './StoryView.vue';

// Истории человека: воспоминания текстом и голосом. Открытая история — поверх карточки, адрес ?story=<id>
// (?story=new — новая): кнопка «Назад» на телефоне её закрывает.
const props = defineProps({ person: Object });
const route = useRoute();
const router = useRouter();
const items = ref([]);
const loaded = ref(false);
const error = ref('');
const extra = ref(null); // открытая по ссылке история, которой нет в списке (например, только что отвязали)

const open = computed(() => {
  const id = route.query.story;
  if (!id || id === 'new') return null;
  return items.value.find((s) => s.id === id) || (extra.value?.id === id ? extra.value : null);
});

async function reload() {
  try {
    items.value = await api('GET', `/api/persons/${props.person.id}/stories`);
    loaded.value = true;
  } catch (e) {
    error.value = e.message;
  }
  // Открытой истории нет в карточке — подгрузить её саму; удалена или не видна — закрыть.
  const id = route.query.story;
  if (id && id !== 'new' && !items.value.some((s) => s.id === id)) {
    extra.value = await api('GET', `/api/stories/${id}`).catch(() => null);
    if (!extra.value) close();
  }
}

async function load() {
  loaded.value = false;
  error.value = '';
  items.value = [];
  if (!props.person.hidden) await reload();
}
watch(() => props.person.id, load, { immediate: true });
onUnmounted(onLive((events) => { if (loaded.value && events.some((e) => e.kind === 'tree')) return reload(); }));

let pushed = false; // открыто отсюда: закрывать шагом назад, чтобы «Назад» не открывал историю снова
function show(id) {
  pushed = true;
  router.push({ query: { ...route.query, story: id } });
}
function close() {
  const { story, ...rest } = route.query;
  if (!story) return;
  if (pushed) router.back();
  else router.replace({ query: rest });
  pushed = false;
}
async function saved(s) {
  extra.value = s;
  if (route.query.story === 'new') await router.replace({ query: { ...route.query, story: s.id } });
  await reload();
}
async function removed() {
  close();
  await reload();
}

const time = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '');
</script>

<template>
  <h2>Истории</h2>
  <div v-if="person.hidden" class="card muted small">Истории о живых родственниках видны только участникам дерева.</div>
  <div v-else class="list stories">
    <div v-if="error" class="error">{{ error }}</div>
    <div v-else-if="!loaded" class="muted">Загрузка…</div>
    <button v-for="s in items" :key="s.id" class="item" @click="show(s.id)">
      <span class="grow">
        <span class="title">{{ s.title }}</span>
        <span class="muted small">{{ [s.date, s.user_name].filter(Boolean).join(' · ') }}</span>
      </span>
      <span v-if="s.audio_id" class="voice" :aria-label="'Есть запись голоса'">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" /></svg>
        <span class="small">{{ time(s.audio_duration) }}</span>
      </span>
      <span class="muted">›</span>
    </button>
    <div v-if="loaded && !items.length" class="muted">
      {{ canEdit() ? 'Пока нет историй. Запишите, что рассказывали о нём родные, — текстом или голосом.' : 'Пока нет историй.' }}
    </div>
    <div v-if="loaded && canEdit()"><button class="primary block" @click="show('new')">+ Рассказать историю</button></div>
  </div>

  <StoryView v-if="open || route.query.story === 'new'" :key="open?.id || 'new'" :story="open" :person="person"
    @close="close" @saved="saved" @removed="removed" />
</template>

<style scoped>
.stories > .item { justify-content: flex-start; text-align: left; background: transparent; border-radius: 0; width: 100%; }
.item .title { display: block; font-size: 17px; font-weight: 600; overflow-wrap: anywhere; }
.item .grow > span { display: block; }
.voice { flex: none; display: flex; align-items: center; gap: 2px; color: var(--accent); }
.voice svg { width: 22px; height: 22px; fill: currentColor; }
</style>
