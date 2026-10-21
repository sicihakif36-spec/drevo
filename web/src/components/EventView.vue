<script setup>
import { computed, reactive, ref } from 'vue';
import { store, canEdit, toast } from '../store.js';
import { api } from '../api.js';
import { factInfo } from '../sources.js';
import { fullName, dateText, lifespan, parentsOf, spousesOf, childrenOf, nameGenitive } from '@shared/names.js';
import DateInput from './DateInput.vue';
import PlaceInput from './PlaceInput.vue';
import { EVENT_KINDS, eventTitle } from '@shared/events.js';
import FactBadge from './FactBadge.vue';
import FactSheet from './FactSheet.vue';
import { ask } from './ask.js';

// Своё событие ленты жизни поверх карточки: просмотр, правка, участники, источники и удаление. event — null для нового.
// Короткая форма: вид, дата, место, описание; название, часть и звание, другие участники — под «Ещё».
const props = defineProps({ event: Object, person: Object, sources: Object });
const emit = defineEmits(['close', 'saved', 'removed', 'changed']);

const e = computed(() => props.event);
const mode = ref(props.event ? 'view' : 'edit'); // view, edit, link
const form = reactive({ kind: '', date: '', place: '', title: '', body: '', unit: '', rank: '' });
const more = ref(false);
const others = ref([]); // другие участники нового события
const saving = ref(false);
const error = ref('');
const query = ref('');
const sheet = ref(false);

const k = computed(() => EVENT_KINDS[mode.value === 'edit' ? form.kind : e.value?.kind] || EVENT_KINDS.other);
const people = computed(() => (e.value?.persons || []).map((id) => store.idx?.persons.get(id)).filter(Boolean));
const fact = computed(() => e.value && { subject: 'event', id: e.value.id, fact: 'event', label: 'Событие', value: [eventTitle(e.value), e.value.date].filter(Boolean).join(', ') });
const info = computed(() => e.value && factInfo(props.sources, 'event', e.value.id, 'event'));
const when = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

// Кого добавить: по поиску, а без поиска — ближайшая родня (переезд всей семьёй).
const taken = computed(() => new Set(e.value ? e.value.persons : [props.person.id, ...others.value.map((x) => x.id)]));
const found = computed(() => {
  const idx = store.idx;
  if (!idx) return [];
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean);
  const pool = words.length
    ? [...idx.persons.values()].filter((p) => words.every((w) => fullName(p).toLowerCase().includes(w)))
    : [...spousesOf(idx, props.person.id).map((s) => s.spouseId), ...childrenOf(idx, props.person.id), ...parentsOf(idx, props.person.id)]
      .map((id) => idx.persons.get(id)).filter(Boolean);
  return pool.filter((p) => !taken.value.has(p.id)).slice(0, 20);
});

function edit() {
  Object.assign(form, Object.fromEntries(Object.keys(form).map((c) => [c, e.value[c]])));
  more.value = Boolean(form.unit || form.rank || (form.title && !k.value.main));
  error.value = '';
  mode.value = 'edit';
}

function cancel() {
  if (!e.value) emit('close');
  else mode.value = 'view';
}

async function save() {
  error.value = '';
  if (!form.kind) {
    error.value = 'Выберите, что это было: учёба, служба, переезд…';
    return;
  }
  // Часть и звание — только у службы и войны.
  const data = { ...form, ...(k.value.military ? {} : { unit: '', rank: '' }) };
  saving.value = true;
  try {
    const saved = e.value
      ? await api('PATCH', `/api/life-events/${e.value.id}`, data)
      : await api('POST', `/api/persons/${props.person.id}/life-events`, { ...data, persons: others.value.map((x) => x.id) });
    // Новое событие откроется заново уже сохранённым (Life.vue).
    if (e.value) mode.value = 'view';
    emit('saved', saved);
    toast('Событие сохранено');
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function link(p) {
  query.value = '';
  if (!e.value) {
    others.value.push(p);
    return;
  }
  try {
    emit('saved', await api('PUT', `/api/life-events/${e.value.id}/persons/${p.id}`));
    toast(`Добавлено: ${fullName(p)}`);
  } catch (err) { toast(err.message); }
}

async function unlink(p) {
  if (!await ask({ text: `Убрать событие из жизни ${nameGenitive(p, true)}?`, note: `${fullName(p)}. У остальных участников событие останется.`, yes: 'Убрать', no: 'Не убирать', danger: true })) return;
  try {
    emit('saved', await api('DELETE', `/api/life-events/${e.value.id}/persons/${p.id}`));
  } catch (err) { toast(err.message); }
}

async function remove() {
  if (!await ask({ text: `Удалить событие «${eventTitle(e.value)}»?`, note: `Оно пропадёт у всех участников. Вернуть можно в «Ещё → Последние правки».`, yes: 'Удалить', no: 'Не удалять', danger: true })) return;
  try {
    await api('DELETE', `/api/life-events/${e.value.id}`);
    toast('Событие удалено. Вернуть можно в «Ещё → Последние правки».');
    emit('removed');
  } catch (err) { toast(err.message); }
}
</script>

<template>
  <div class="event" role="dialog" aria-modal="true">
    <div class="page">
      <div class="row top">
        <button class="ghost" @click="mode === 'edit' ? cancel() : emit('close')">‹ {{ mode === 'edit' ? 'Отмена' : 'Назад' }}</button>
      </div>

      <form v-if="mode === 'edit'" @submit.prevent="save">
        <h1>{{ e ? 'Изменить событие' : 'Новое событие' }}</h1>
        <p v-if="!e" class="muted">В ленте жизни: {{ fullName(person) }}</p>
        <div class="kinds" role="radiogroup" aria-label="Что было">
          <button v-for="(x, key) in EVENT_KINDS" :key="key" type="button" role="radio" :aria-checked="form.kind === key"
            :class="{ on: form.kind === key }" @click="form.kind = key">{{ x.label }}</button>
        </div>
        <template v-if="form.kind">
          <label v-if="k.main" class="field"><span>{{ k.title }}</span><input v-model="form.title" maxlength="300" :placeholder="k.hint" /></label>
          <DateInput v-model="form.date" label="Когда" placeholder="например: 1941–1945, с 1950 по 1962, около 1930" />
          <PlaceInput v-model="form.place" :label="k.place || 'Где'" placeholder="например: г. Калинин" />
          <label class="field"><span>Описание</span><textarea v-model="form.body" maxlength="20000" rows="4" placeholder="Что известно об этом" /></label>

          <button v-if="!more" type="button" class="block more" @click="more = true">Ещё: {{ [!k.main && k.title.toLowerCase(), k.military && 'часть и звание', !e && 'другие участники'].filter(Boolean).join(', ') }}</button>
          <template v-else>
            <label v-if="!k.main" class="field"><span>{{ k.title }}</span><input v-model="form.title" maxlength="300" :placeholder="k.hint" /></label>
            <template v-if="k.military">
              <label class="field"><span>Часть</span><input v-model="form.unit" maxlength="300" placeholder="например: 1-я ударная армия, 45-я стрелковая дивизия" /></label>
              <label class="field"><span>Звание</span><input v-model="form.rank" maxlength="100" placeholder="например: сержант" /></label>
            </template>
            <template v-if="!e">
              <h2>Другие участники</h2>
              <p class="muted small">Событие будет и в их ленте жизни: например, переезд всей семьёй.</p>
              <div v-if="others.length" class="list">
                <div v-for="x in others" :key="x.id">
                  <div class="avatar" :class="x.sex">{{ (x.given || '?')[0] }}</div>
                  <div class="grow ellipsis">{{ fullName(x) }}</div>
                  <button type="button" class="danger" :aria-label="`Убрать: ${fullName(x)}`" @click="others = others.filter((o) => o !== x)">✕</button>
                </div>
              </div>
              <input v-model="query" type="search" class="search" placeholder="Начните писать фамилию или имя" />
              <div v-if="found.length" class="list found">
                <button v-for="x in found" :key="x.id" type="button" class="pick" @click="link(x)">
                  <div class="avatar" :class="x.sex">{{ (x.given || '?')[0] }}</div>
                  <div class="grow"><div class="ellipsis">{{ fullName(x) }}</div><div class="muted small">{{ lifespan(x) }}</div></div>
                  <span class="plus">+</span>
                </button>
              </div>
            </template>
          </template>
        </template>

        <p class="error" v-if="error">{{ error }}</p>
        <div class="row actions">
          <button type="button" class="grow" @click="cancel">Отмена</button>
          <button class="primary grow" :disabled="saving">{{ saving ? 'Сохраняю…' : 'Сохранить' }}</button>
        </div>
      </form>

      <template v-else>
        <div class="muted">{{ EVENT_KINDS[e.kind]?.label }}</div>
        <h1>{{ k.main && e.title ? e.title : eventTitle(e) }}</h1>
        <div class="facts">
          <div v-if="e.date"><span class="muted small">Когда</span>{{ dateText(e.date) }}</div>
          <div v-if="e.place"><span class="muted small">{{ k.place || 'Где' }}</span>
            <router-link :to="{ path: '/place', query: { text: e.place } }" class="placelink">{{ e.place }}</router-link></div>
          <div v-if="e.title && !k.main"><span class="muted small">{{ k.title }}</span>{{ e.title }}</div>
          <div v-if="e.unit"><span class="muted small">Часть</span>{{ e.unit }}</div>
          <div v-if="e.rank"><span class="muted small">Звание</span>{{ e.rank }}</div>
        </div>
        <FactBadge class="evbadge" :info="info" :editable="canEdit()" @open="sheet = true" />
        <div v-if="e.body" class="body">{{ e.body }}</div>
        <div class="muted small added">записано {{ when(e.created_at) }}, {{ e.user_name || 'кто-то' }}</div>

        <h2>Участники</h2>
        <div class="list">
          <div v-for="x in people" :key="x.id">
            <router-link :to="`/person/${x.id}`" class="who grow">
              <div class="avatar" :class="x.sex">{{ (x.given || '?')[0] }}</div>
              <div class="grow"><div class="ellipsis">{{ fullName(x) }}</div><div class="muted small">{{ lifespan(x) }}</div></div>
            </router-link>
            <button v-if="mode === 'link' && people.length > 1" class="danger" :aria-label="`Убрать: ${fullName(x)}`" @click="unlink(x)">✕</button>
          </div>
        </div>

        <template v-if="mode === 'link'">
          <h2>Добавить участника</h2>
          <input v-model="query" type="search" placeholder="Начните писать фамилию или имя" />
          <div v-if="found.length" class="list found">
            <button v-for="x in found" :key="x.id" class="pick" @click="link(x)">
              <div class="avatar" :class="x.sex">{{ (x.given || '?')[0] }}</div>
              <div class="grow"><div class="ellipsis">{{ fullName(x) }}</div><div class="muted small">{{ lifespan(x) }}</div></div>
              <span class="plus">+</span>
            </button>
          </div>
          <p v-else-if="query.trim()" class="muted">Никого не нашлось.</p>
          <button class="primary block done" @click="mode = 'view'">Готово</button>
        </template>

        <div v-else-if="canEdit()" class="actions-col">
          <button class="block" @click="edit">Изменить</button>
          <button class="block" @click="query = ''; mode = 'link'">Участники</button>
          <button class="danger block" @click="remove">Удалить событие</button>
        </div>
      </template>
    </div>

    <!-- Внутри окна события: так окно сведения встаёт поверх него. -->
    <FactSheet v-if="sheet" :fact="fact" :facts="[fact]" :data="sources" :person="person" @close="sheet = false" @changed="emit('changed')" />
  </div>
</template>

<style scoped>
.event { position: fixed; inset: 0; z-index: 50; background: var(--bg); overflow-y: auto; overscroll-behavior: contain; }
.event .page { padding-bottom: calc(32px + var(--safe-b)); }
.top { margin-bottom: 8px; }
h1 { font-size: 1.333rem; overflow-wrap: anywhere; margin-top: 2px; }
.kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0 6px; }
.kinds button { min-height: 60px; font-size: 0.944rem; background: var(--card); border: 2px solid var(--field); color: var(--text); }
.kinds button.on { border-color: var(--accent-text); background: var(--accent-soft); font-weight: 600; }
.more { margin-top: 6px; background: transparent; border: 2px dashed var(--field); color: var(--accent-text); }
.search { margin-top: 8px; }
.facts { display: flex; flex-direction: column; gap: 10px; font-size: 1rem; margin: 4px 0 12px; }
.facts span { display: block; }
.body { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 1rem; line-height: 1.55; margin-top: 16px; }
.added { margin-top: 14px; }
.placelink { color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; overflow-wrap: anywhere; }
.who { display: flex; align-items: center; gap: 12px; color: inherit; text-decoration: none; }
.found { margin-top: 8px; }
.pick { justify-content: flex-start; text-align: left; background: transparent; border-radius: 0; width: 100%; }
.plus { font-size: 1.444rem; color: var(--accent-text); }
.actions { margin-top: 16px; }
.actions-col { display: flex; flex-direction: column; gap: 8px; margin-top: 22px; }
.done { margin-top: 12px; }
</style>
