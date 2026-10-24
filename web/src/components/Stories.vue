<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { canEdit, canTalk, onLive } from '../store.js';
import { api } from '../api.js';
import StoryView from './StoryView.vue';
import { ivTitle } from '@shared/interview.js';

// Истории человека: воспоминания текстом и голосом. Открытая история — поверх карточки, адрес ?story=<id>
// (?story=new — новая): кнопка «Назад» на телефоне её закрывает.
// Истории из интервью — одной строкой «Интервью 24 октября: 12 ответов», внутри — по порядку ответов.
// Незаконченные интервью с человеком видят тот, кто их начал, владелец и участники: «Продолжить интервью».
const props = defineProps({ person: Object });
const emit = defineEmits(['count']); // сколько историй — для закладки в карточке
const route = useRoute();
const router = useRouter();
const items = ref([]);
const loaded = ref(false);
const error = ref('');
const extra = ref(null); // открытая по ссылке история, которой нет в списке (например, только что отвязали)
const drafts = ref([]); // незаконченные интервью
const unfold = ref(new Set()); // раскрытые интервью

// Строки списка: история или интервью (на месте его первой истории).
const rows = computed(() => {
  const out = [];
  const groups = new Map();
  for (const s of items.value) {
    if (!s.interview_id) {
      out.push({ story: s });
      continue;
    }
    if (!groups.has(s.interview_id)) {
      const g = { interview: s.interview_id, at: s.interview_at, list: [] };
      groups.set(s.interview_id, g);
      out.push(g);
    }
    groups.get(s.interview_id).list.push(s);
  }
  for (const g of groups.values()) g.list.sort((a, b) => a.interview_no - b.interview_no);
  return out;
});
// По порядку — для «Следующий ответ» в открытой истории.
const chain = computed(() => {
  const s = open.value;
  return s?.interview_id ? rows.value.find((r) => r.interview === s.interview_id)?.list.map((x) => x.id) || [] : [];
});
function fold(id) {
  const x = new Set(unfold.value);
  if (x.has(id)) x.delete(id);
  else x.add(id);
  unfold.value = x;
}
const answers = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'ответ' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'ответа' : 'ответов'}`;

const open = computed(() => {
  const id = route.query.story;
  if (!id || id === 'new') return null;
  return items.value.find((s) => s.id === id) || (extra.value?.id === id ? extra.value : null);
});

async function reload() {
  try {
    const [list, ivs] = await Promise.all([
      api('GET', `/api/persons/${props.person.id}/stories`),
      canTalk() ? api('GET', `/api/interviews?person=${props.person.id}`).catch(() => []) : [],
    ]);
    items.value = list;
    drafts.value = ivs.filter((x) => !x.saved);
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
watch([loaded, () => items.value.length], ([l, n]) => emit('count', l ? n : null), { immediate: true });
onUnmounted(onLive((events) => { if (loaded.value && events.some((e) => e.kind === 'tree' || e.kind === 'interviews')) return reload(); }));

let pushed = false; // открыто отсюда: закрывать шагом назад, чтобы «Назад» не открывал историю снова
function show(id) {
  pushed = true;
  router.push({ query: { ...route.query, story: id } });
}
// Следующий ответ интервью — вместо открытой истории, без лишнего шага «Назад».
function go(id) {
  router.replace({ query: { ...route.query, story: id } });
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
    <div v-for="d in drafts" :key="d.id" class="draft">
      <span class="grow">
        <span class="title">Незаконченное интервью</span>
        <span class="muted small">{{ ivTitle(d.created_at).replace('Интервью ', '') }} · {{ d.answered }} из {{ d.total }} ответов{{ d.by_name ? ` · ${d.by_name}` : '' }}</span>
      </span>
      <router-link class="btn primary block" :to="`/interview/${d.id}`">Продолжить интервью</router-link>
    </div>
    <template v-for="r in rows" :key="r.story?.id || r.interview">
      <button v-if="r.story" class="item" @click="show(r.story.id)">
        <span class="grow">
          <span class="title">{{ r.story.title }}</span>
          <span class="muted small">{{ [r.story.date, r.story.user_name].filter(Boolean).join(' · ') }}</span>
        </span>
        <span v-if="r.story.audio_id" class="voice" :aria-label="'Есть запись голоса'">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" /></svg>
          <span class="small">{{ time(r.story.audio_duration) }}</span>
        </span>
        <span class="muted">›</span>
      </button>
      <template v-else>
        <button class="item iv" :aria-expanded="unfold.has(r.interview)" @click="fold(r.interview)">
          <span class="mic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" /></svg></span>
          <span class="grow"><span class="title">{{ ivTitle(r.at) }}: {{ answers(r.list.length) }}</span></span>
          <span class="muted">{{ unfold.has(r.interview) ? '˄' : '˅' }}</span>
        </button>
        <template v-if="unfold.has(r.interview)">
          <button v-for="s in r.list" :key="s.id" class="item sub" @click="show(s.id)">
            <span class="no muted">{{ s.interview_no }}</span>
            <span class="grow"><span class="title">{{ s.title }}</span></span>
            <span v-if="s.audio_id" class="voice small">{{ time(s.audio_duration) }}</span>
            <span class="muted">›</span>
          </button>
        </template>
      </template>
    </template>
    <div v-if="loaded && !items.length && !drafts.length" class="muted">
      {{ canEdit() ? 'Пока нет историй. Запишите, что рассказывали о нём родные, — текстом или голосом.' : 'Пока нет историй.' }}
    </div>
    <div v-if="loaded && canTalk()" class="adds">
      <button v-if="canEdit()" class="primary block" @click="show('new')">+ Рассказать историю</button>
      <router-link class="btn block" :class="{ primary: !canEdit() }" :to="{ path: '/interview/new', query: { person: person.id } }">
        Записать воспоминания<span class="muted small hint">интервью по вопросам, голосом</span>
      </router-link>
    </div>
  </div>

  <StoryView v-if="open || route.query.story === 'new'" :key="open?.id || 'new'" :story="open" :person="person" :chain="chain"
    @close="close" @saved="saved" @removed="removed" @go="go" />
</template>

<style scoped>
.stories > .item { justify-content: flex-start; text-align: left; background: transparent; border-radius: 0; width: 100%; }
.item .title { display: block; font-size: 0.944rem; font-weight: 600; overflow-wrap: anywhere; }
.item .grow > span { display: block; }
.voice { flex: none; display: flex; align-items: center; gap: 2px; color: var(--accent-text); }
.voice svg { width: 22px; height: 22px; fill: currentColor; }
.stories > .draft { background: var(--accent-soft); color: var(--accent-soft-text); display: grid; gap: 0.444rem; }
.draft .grow > span { display: block; }
.draft .title { font-size: 1rem !important; }
.stories > .iv { gap: 0.556rem; }
.mic { flex: none; width: 2.222rem; height: 2.222rem; border-radius: 50%; background: var(--accent-soft); color: var(--accent-text); display: grid; place-items: center; }
.mic svg { width: 1.222rem; height: 1.222rem; fill: currentColor; }
.stories > .sub { padding-left: 1.333rem; background: var(--bg); }
.sub .no { flex: none; width: 1.556rem; font-variant-numeric: tabular-nums; }
.adds { display: grid !important; gap: 0.444rem; }
.adds .btn { flex-direction: column; gap: 0; }
.adds .hint { font-weight: 400; color: inherit; opacity: .8; }
</style>
