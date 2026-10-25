<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store, canEdit, isGuest, loadTree, toast, onLive } from '../store.js';
import { api } from '../api.js';
import { fullName, dateText, parsePeriod } from '@shared/names.js';
import { placeKey } from '@shared/places.js';
import { eventTitle } from '@shared/events.js';
import PlaceForm from '../components/PlaceForm.vue';
import { ask } from '../components/ask.js';

// Карточка места: полное старое название, как это сейчас, и кто здесь родился, вступил в брак, жил, умер, похоронен.
// Адрес: /place?id=<место справочника> или /place?text=<место, как записано в карточке>.
const route = useRoute();
const router = useRouter();
const card = ref(null);
const error = ref('');
const form = ref(null); // { place } или { from } — окно места
const linking = ref(false);
const query = ref('');

async function load() {
  error.value = '';
  const { id, text } = route.query;
  if (!id && !text) return;
  try {
    card.value = await api('GET', `/api/places/card?${new URLSearchParams(id ? { id } : { text })}`);
  } catch (e) {
    card.value = null;
    error.value = e.message;
  }
}
watch(() => route.fullPath, () => { if (route.path === '/place') load(); }, { immediate: true });
onUnmounted(onLive((events) => { if (events.some((e) => e.kind === 'tree')) return load(); }));

const person = (id) => store.idx?.persons.get(id);
const byDate = (a, b) => (parsePeriod(a.date)?.key ?? Infinity) - (parsePeriod(b.date)?.key ?? Infinity);
// Разделы карточки: люди с датой. Удалённых и тех, кого нет в дереве у этого телефона, не показываем.
const sections = computed(() => {
  const c = card.value;
  if (!c) return [];
  const people = (rows) => rows.map((r) => ({ ...r, who: [person(r.id)] })).filter((r) => r.who[0]).sort(byDate);
  const married = c.married.map((f) => ({ id: f.id, date: f.date, who: [person(f.partner1), person(f.partner2)].filter(Boolean),
    note: f.kind === 'partners' ? 'вместе' : 'брак' })).filter((r) => r.who.length).sort(byDate);
  const lived = c.events.map((e) => ({ id: e.id, date: e.date, who: e.persons.map(person).filter(Boolean), note: eventTitle(e), event: e }))
    .filter((r) => r.who.length).sort(byDate);
  return [
    ['Родились', people(c.born)], ['Вступили в брак', married], ['Жили, учились, служили', lived],
    ['Умерли', people(c.died)], ['Похоронены', people(c.buried)],
  ].filter(([, rows]) => rows.length);
});
const p = computed(() => card.value?.place);

// Выбрать для этого текста место из справочника: подходящие по набранным словам.
const choices = computed(() => {
  const words = placeKey(query.value).split(' ').filter(Boolean);
  return (store.tree?.places || []).filter((x) => words.every((w) => placeKey(`${x.title} ${x.now}`).includes(w))).slice(0, 8);
});
async function adopt(x) {
  if (!await ask({ text: `Записать «${x.title}» у всех, у кого сейчас «${card.value.text}»?`, yes: 'Записать', no: 'Не записывать' })) return;
  try {
    await api('POST', `/api/places/${x.id}/adopt`, { text: card.value.text });
    await loadTree();
    toast('Записано');
    router.replace({ path: '/place', query: { id: x.id } });
    linking.value = false;
  } catch (e) { toast(e.message); }
}
function saved(x) {
  form.value = null;
  router.replace({ path: '/place', query: { id: x.id } });
  load();
}
async function remove() {
  if (!await ask({ text: `Убрать «${p.value.title}» из справочника?`, note: 'У людей место останется записанным текстом. Вернуть можно в «Главная → Последние правки».', yes: 'Убрать', no: 'Не убирать', danger: true })) return;
  try {
    await api('DELETE', `/api/places/${p.value.id}`);
    await loadTree();
    toast('Убрано из справочника');
    router.replace({ path: '/place', query: { text: p.value.title } });
  } catch (e) { toast(e.message); }
}
function open(r) {
  if (r.event) router.push({ path: `/person/${r.who[0].id}`, query: { event: r.event.id } });
  else router.push(`/person/${r.who[0].id}`);
}
</script>

<template>
  <div class="page">
    <div class="row" style="margin-bottom:8px">
      <button class="ghost" @click="router.back()" aria-label="Назад">‹ Назад</button>
      <span class="grow" />
      <button v-if="canEdit() && p" @click="form = { place: p }">Изменить</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!card" class="muted">Загрузка…</p>
    <template v-else>
      <div class="muted">{{ p ? 'место из справочника' : 'место' }}</div>
      <h1>{{ card.text }}</h1>
      <p v-if="p?.now" class="now">сейчас: {{ p.now }}</p>
      <p v-if="p?.note" class="pre">{{ p.note }}</p>

      <div v-if="!p && canEdit()" class="card">
        <p class="small" style="margin-top:0">Этого места нет в справочнике. Добавьте его — со старым делением (волость, уезд, губерния) и тем,
          как это называется сейчас. Или выберите, если оно уже есть, но записано по-другому.</p>
        <div class="row wrap">
          <button class="primary" @click="form = { from: card.text }">Добавить в справочник</button>
          <button v-if="store.tree?.places?.length" @click="linking = !linking">Выбрать из справочника</button>
        </div>
        <template v-if="linking">
          <input v-model="query" type="search" placeholder="Начните писать название" style="margin-top:10px" />
          <div class="list" style="margin-top:8px">
            <button v-for="x in choices" :key="x.id" class="pick" @click="adopt(x)">
              <span class="grow"><span>{{ x.title }}</span><span v-if="x.now" class="muted small">сейчас: {{ x.now }}</span></span>
            </button>
            <div v-if="!choices.length" class="muted">Ничего не нашлось</div>
          </div>
        </template>
      </div>

      <template v-for="[label, rows] in sections" :key="label">
        <h2>{{ label }}</h2>
        <div class="list">
          <a v-for="r in rows" :key="r.id" href="#" @click.prevent="open(r)">
            <div class="avatar" :class="r.who[0].sex">{{ (r.who[0].given || '?')[0] }}</div>
            <div class="grow">
              <div>{{ r.who.map(fullName).join(' и ') }}</div>
              <div v-if="r.note || r.date" class="muted small">{{ [r.note, dateText(r.date)].filter(Boolean).join(' · ') }}</div>
            </div>
            <span class="muted">›</span>
          </a>
        </div>
      </template>
      <p v-if="!sections.length" class="muted">В дереве пока никого с этим местом.</p>
      <p v-if="isGuest()" class="muted small">Живые родственники здесь не показаны.</p>

      <div v-if="canEdit() && p" class="list" style="margin-top:24px">
        <a href="#" class="danger-link" @click.prevent="remove">Убрать из справочника</a>
      </div>
    </template>

    <PlaceForm v-if="form" :place="form.place" :from="form.from" @close="form = null" @saved="saved" />
  </div>
</template>

<style scoped>
h1 { margin: 2px 0 6px; overflow-wrap: anywhere; }
.now { font-size: 1rem; margin: 0 0 8px; }
.pre { white-space: pre-wrap; }
.pick { justify-content: flex-start; text-align: left; background: transparent; border-radius: 0; width: 100%; }
.pick .grow > span { display: block; }
.danger-link { color: var(--danger) !important; }
</style>
