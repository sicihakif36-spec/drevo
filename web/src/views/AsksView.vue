<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { canEdit, onLive } from '../store.js';
import { api } from '../api.js';
import { STATUS, when } from '../asks.js';

// «Главная → Вопросы родным»: кого о чём спросили и ответили ли. У того, кого спросили, — «Вас спросили» до ответа.
const mine = ref(null);
const all = ref(null);
const error = ref('');

async function load() {
  try {
    [mine.value, all.value] = await Promise.all([api('GET', '/api/asks/mine'), canEdit() ? api('GET', '/api/asks') : null]);
    error.value = '';
  } catch (e) {
    error.value = e.message;
  }
}
onMounted(load);
onUnmounted(onLive((events) => { if (events.some((e) => e.kind === 'asks')) return load(); }));

// Сначала ответы, которые ещё не разобраны, потом ждущие, потом остальное.
const ORDER = { answered: 0, waiting: 1, expired: 2, closed: 3, revoked: 4 };
const list = computed(() => [...(all.value || [])].sort((a, b) => ORDER[a.status] - ORDER[b.status]));
const short = (t, n = 120) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
</script>

<template>
  <div class="page">
    <h1>{{ canEdit() ? 'Вопросы родным' : 'Вас спросили' }}</h1>
    <div v-if="error" class="error">{{ error }}</div>

    <template v-if="mine?.length">
      <h2 v-if="canEdit()">Вас спросили</h2>
      <div class="list">
        <router-link v-for="a in mine" :key="a.id" :to="`/asks/${a.id}`" class="asked">
          <div class="grow">
            <div class="small muted">{{ a.from_name || 'Кто-то' }} · {{ when(a.created_at) }} · о ком: {{ a.about }}</div>
            <div class="q">{{ short(a.question) }}</div>
          </div>
          <span class="btn primary go">Ответить</span>
        </router-link>
      </div>
    </template>
    <p v-else-if="mine && !canEdit()" class="muted">Пока вас ни о чём не спрашивали. Когда спросят, вопрос появится здесь и в ленте.</p>

    <template v-if="canEdit()">
      <p class="muted small intro">Спросить можно из карточки человека («Спросить у родных»), из проверки дерева и из исследования.
        Тому, кто пользуется приложением, придёт уведомление; тому, кто не пользуется, — ссылка без входа.</p>
      <h2>Спросили</h2>
      <div v-if="!all" class="muted">Загрузка…</div>
      <div v-else class="list">
        <router-link v-for="a in list" :key="a.id" :to="`/asks/${a.id}`">
          <div class="grow">
            <div class="small muted">{{ a.from_name || 'Кто-то' }} → {{ a.to_name }}{{ a.link ? ' (ссылка)' : '' }} · {{ when(a.created_at) }}</div>
            <div class="about">{{ a.about }}</div>
            <div class="q">{{ short(a.question) }}</div>
            <div class="small"><span class="status" :class="a.status">{{ STATUS[a.status] }}</span>
              <span v-if="a.story" class="muted"> · сохранено как история</span><span v-if="a.note" class="muted"> · в журнале поиска</span></div>
          </div>
          <span class="muted" aria-hidden="true">›</span>
        </router-link>
        <div v-if="!list.length" class="muted">Пока никого ни о чём не спрашивали</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.intro { margin: 0 0 0.222rem; }
.asked { align-items: flex-start !important; flex-wrap: wrap; }
.go { flex: 1 1 100%; min-height: 2.889rem; }
.about { font-weight: 700; overflow-wrap: anywhere; }
.q { overflow-wrap: anywhere; }
.status { font-weight: 700; color: var(--muted); }
.status.answered { color: var(--accent-text); }
.status.waiting { color: var(--oral); }
</style>
