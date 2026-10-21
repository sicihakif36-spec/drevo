<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store, canEdit, onLive } from '../store.js';
import { api } from '../api.js';
import { lifeItems } from '../life.js';
import { factInfo } from '../sources.js';
import FactBadge from './FactBadge.vue';
import EventView from './EventView.vue';
import MarriageSheet from './MarriageSheet.vue';

// «Жизнь» в карточке: лента по годам. Сведения из дерева подставляются сами, нажатие ведёт туда, где они правятся;
// брак — окно «Брак»; свои события (учёба, служба, переезд…) открываются поверх карточки, адрес ?event=<id> (?event=new — новое).
// sources — источники и достоверность карточки (GET /api/persons/:id/sources), у событий там же.
const props = defineProps({ person: Object, sources: Object });
const emit = defineEmits(['edit', 'changed']);
const route = useRoute();
const router = useRouter();
const events = ref([]);
const loaded = ref(false);
const error = ref('');
const extra = ref(null); // открытое по ссылке событие, которого нет в ленте (например, только что убрали участника)
const marriage = ref(null); // { family, spouse } — окно «Брак»

const items = computed(() => (store.idx ? lifeItems(props.person, store.idx, events.value) : []));
const open = computed(() => {
  const id = route.query.event;
  if (!id || id === 'new') return null;
  return events.value.find((e) => e.id === id) || (extra.value?.id === id ? extra.value : null);
});
const info = (e) => factInfo(props.sources, 'event', e.id, 'event');

async function reload() {
  try {
    events.value = await api('GET', `/api/persons/${props.person.id}/life-events`);
    loaded.value = true;
  } catch (e) {
    error.value = e.message;
  }
  // Открытого события нет в ленте — подгрузить его само; удалено или не видно — закрыть.
  const id = route.query.event;
  if (id && id !== 'new' && !events.value.some((e) => e.id === id)) {
    extra.value = await api('GET', `/api/life-events/${id}`).catch(() => null);
    if (!extra.value) close();
  }
}
async function load() {
  loaded.value = false;
  error.value = '';
  events.value = [];
  if (!props.person.hidden) await reload();
}
watch(() => props.person.id, load, { immediate: true });
onUnmounted(onLive((ev) => { if (loaded.value && ev.some((e) => e.kind === 'tree')) return reload(); }));

let pushed = false; // открыто отсюда: закрывать шагом назад, чтобы «Назад» не открывал событие снова
function show(id) {
  pushed = true;
  router.push({ query: { ...route.query, event: id } });
}
function close() {
  const { event, ...rest } = route.query;
  if (!event) return;
  if (pushed) router.back();
  else router.replace({ query: rest });
  pushed = false;
}
async function saved(e) {
  extra.value = e;
  if (route.query.event === 'new') await router.replace({ query: { ...route.query, event: e.id } });
  await reload();
  emit('changed');
}
async function removed() {
  close();
  await reload();
  emit('changed');
}

const goes = (x) => Boolean(x.event || x.go !== 'edit' || canEdit());
// Нажатие на пункт: своё событие — открыть; сведение из дерева — туда, где оно правится.
function tap(x) {
  if (x.event) return show(x.event.id);
  if (x.go === 'edit') return canEdit() && emit('edit');
  if (x.go.person) return router.push(`/person/${x.go.person.id}`);
  if (canEdit()) marriage.value = x.go;
  else router.push(`/person/${x.go.spouse.id}`);
}
// Год слева — первый, у периода тоже; без года — «без даты».
const year = (x) => (x.at ? String(x.at.year) : 'без даты');
// Дата словами — если в ней есть что-то кроме года.
const when = (x) => (x.date && x.date !== year(x) ? x.date : '');
</script>

<template>
  <h2>Жизнь</h2>
  <div v-if="person.hidden" class="card muted small">Ленту жизни живых родственников видят только участники дерева.</div>
  <div v-else class="list life">
    <div v-if="error" class="error">{{ error }}</div>
    <div v-for="x in items" :key="x.key" class="item" :class="{ own: x.event, undated: !x.at, still: !goes(x) }"
      :role="goes(x) ? 'button' : null" :tabindex="goes(x) ? 0 : null" @click="goes(x) && tap(x)" @keydown.enter="goes(x) && tap(x)">
      <span class="year">{{ year(x) }}</span>
      <span class="grow">
        <span class="title">{{ x.title }}</span>
        <span v-if="x.note" class="note">{{ x.note }}</span>
        <span v-if="when(x) || x.place || x.age" class="muted small">{{ [when(x), x.place, x.age].filter(Boolean).join(' · ') }}</span>
        <FactBadge v-if="x.event" :info="info(x.event)" @open="show(x.event.id)" />
      </span>
      <span v-if="goes(x)" class="muted">›</span>
    </div>
    <div v-if="loaded && items.length < 2 && canEdit()" class="muted">
      Учёба, служба, работа, переезды, награды — добавьте, что помните. Рождение, браки и дети встанут сами.
    </div>
    <div v-if="loaded && canEdit()"><button class="primary block" @click="show('new')">+ Добавить событие</button></div>
  </div>

  <EventView v-if="open || route.query.event === 'new'" :key="open?.id || 'new'" :event="open" :person="person" :sources="sources"
    @close="close" @saved="saved" @removed="removed" @changed="emit('changed')" />

  <MarriageSheet v-if="marriage" :family="marriage.family" :spouse="marriage.spouse" @close="marriage = null" />
</template>

<style scoped>
.life > .item { align-items: flex-start; cursor: pointer; }
.life > .item.still { cursor: default; }
.year { flex: none; width: 50px; font-size: 18px; font-weight: 700; line-height: 1.35; color: var(--accent); overflow-wrap: anywhere; }
.undated .year { font-size: 13px; font-weight: 400; color: var(--muted); padding-top: 3px; }
.item .grow > span { display: block; }
.title { font-size: 17px; font-weight: 600; overflow-wrap: anywhere; }
.own .title { color: var(--text); }
.note { overflow-wrap: anywhere; }
.item .grow > .badge { display: inline-flex; margin-top: 6px; }
.item > .muted { align-self: center; }
</style>
