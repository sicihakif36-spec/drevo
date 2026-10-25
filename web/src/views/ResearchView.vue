<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { store, canEdit, onLive, toast } from '../store.js';
import { api } from '../api.js';
import { STATUSES, QUESTION_MAX } from '@shared/research.js';
import { fullName, lifespan, personHas, textHas } from '@shared/names.js';

// «Главная → Исследование» (владелец и участники): все вопросы поиска по дереву, сначала «ищем».
// Нажатие — карточка человека с раскрытым вопросом; «Новый вопрос» — выбрать человека и написать, что хотим узнать.
const router = useRouter();
const items = ref([]);
const loaded = ref(false);
const error = ref('');
const find = ref('');
const all = ref(false); // показывать и закрытые вопросы
const adding = ref(null); // { find, person, title, error }
const saving = ref(false);

async function load() {
  try {
    items.value = await api('GET', '/api/research');
    loaded.value = true;
  } catch (e) {
    error.value = e.message;
  }
}
onMounted(() => { if (canEdit()) load(); });
onUnmounted(onLive((events) => { if (loaded.value && events.some((e) => e.kind === 'tree')) return load(); }));

const person = (id) => store.idx?.persons.get(id);
const shown = computed(() => {
  const t = find.value.trim();
  return items.value
    .filter((x) => person(x.person_id))
    .filter((x) => all.value || t || x.status === 'open')
    .filter((x) => !t || textHas(x.title, t) || personHas(person(x.person_id), t));
});
// По людям: у кого больше открытых вопросов — выше не поднимаем, порядок — как пришёл (сначала «ищем», потом свежие).
const groups = computed(() => {
  const out = new Map();
  for (const x of shown.value) {
    if (!out.has(x.person_id)) out.set(x.person_id, []);
    out.get(x.person_id).push(x);
  }
  return [...out].map(([id, list]) => ({ p: person(id), list }));
});
const openCount = computed(() => items.value.filter((x) => x.status === 'open' && person(x.person_id)).length);
const closedCount = computed(() => items.value.filter((x) => x.status !== 'open' && person(x.person_id)).length);

const go = (x) => router.push({ path: `/person/${x.person_id}`, query: { q: x.id } });

// Новый вопрос: человек из дерева и что хотим узнать.
const found = computed(() => {
  const t = adding.value?.find.trim() || '';
  return t.length < 2 ? [] : [...(store.idx?.persons.values() || [])].filter((x) => personHas(x, t)).slice(0, 8);
});
function startAdd() {
  adding.value = { find: '', person: null, title: '', error: '' };
}
async function saveAdd() {
  const a = adding.value;
  a.error = '';
  if (!a.person) { a.error = 'Выберите человека'; return; }
  if (!a.title.trim()) { a.error = 'Напишите, что хотите узнать'; return; }
  saving.value = true;
  try {
    const x = await api('POST', `/api/persons/${a.person.id}/research`, { title: a.title.trim().slice(0, QUESTION_MAX) });
    adding.value = null;
    toast('Вопрос добавлен');
    go(x);
  } catch (e) {
    a.error = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page">
    <router-link to="/" class="small">‹ Главная</router-link>
    <h1>Исследование</h1>
    <p v-if="!canEdit()" class="muted">Этот раздел — для владельца и участников дерева.</p>
    <template v-else>
      <p class="small" style="margin-top:0">Что ищем о предках и родных в архивах и на сайтах, где уже искали и что нашли.
        Видят только владелец и участники — чтобы двое не искали одно и то же.</p>
      <button class="primary block" @click="startAdd">+ Новый вопрос</button>

      <input v-model="find" class="search" type="search" placeholder="Поиск: имя или вопрос" aria-label="Поиск по вопросам" />
      <div class="seg filter">
        <button :class="{ on: !all }" @click="all = false">Ищем{{ openCount ? ` — ${openCount}` : '' }}</button>
        <button :class="{ on: all }" @click="all = true">Все вопросы{{ openCount + closedCount ? ` — ${openCount + closedCount}` : '' }}</button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <div v-else-if="!loaded" class="muted">Загрузка…</div>
      <template v-else>
        <div v-for="g in groups" :key="g.p.id" class="group">
          <router-link :to="`/person/${g.p.id}`" class="who">
            <div class="avatar" :class="g.p.sex">{{ (g.p.given || '?')[0] }}</div>
            <div class="grow"><div class="name">{{ fullName(g.p) }}</div><div class="muted small">{{ lifespan(g.p) }}</div></div>
          </router-link>
          <div class="list">
            <button v-for="x in g.list" :key="x.id" class="item" @click="go(x)">
              <span class="tag" :class="x.status">{{ STATUSES[x.status].label }}</span>
              <span class="grow"><span class="title">{{ x.title }}</span>
                <span class="muted small">{{ x.user_name || 'Кто-то' }}{{ x.notes ? ` · записей: ${x.notes}` : ' · записей пока нет' }}</span></span>
              <span class="muted" aria-hidden="true">›</span>
            </button>
          </div>
        </div>
        <div v-if="!groups.length" class="card muted">
          <template v-if="find.trim()">Ничего не нашлось.</template>
          <template v-else-if="!all && closedCount">Открытых вопросов нет. Все вопросы — в «Все вопросы».</template>
          <template v-else>Вопросов пока нет. Нажмите «Новый вопрос»: например, «родители Ситдика» или «где погиб Мидхать в 1943».</template>
        </div>
      </template>

      <h2>Как искать с ИИ-помощником</h2>
      <div class="card small how">
        <div>1. Откройте вопрос и нажмите <b>«Подготовить запрос»</b> — приложение соберёт всё, что известно о человеке и родных.</div>
        <div>2. Скопируйте текст и вставьте в чат ИИ-помощника.</div>
        <div>3. Ответ помощника целиком вставьте в <b>«Загрузить результат»</b>. Перед загрузкой видно, кого он нашёл,
          а загрузку можно отменить одной кнопкой.</div>
        <div class="muted">Сервер «Древа» сам ни к какому ИИ не обращается: что отправлять помощнику, решаете вы.
          Даты и места живых в запрос по умолчанию не попадают.</div>
      </div>
    </template>

    <template v-if="adding">
      <div class="sheet-backdrop" @click="adding = null" />
      <form class="sheet" role="dialog" aria-modal="true" aria-labelledby="add-title" @submit.prevent="saveAdd">
        <h2 id="add-title" style="margin-top:0">Новый вопрос</h2>
        <div class="field"><span>О ком</span>
          <div v-if="adding.person" class="row picked">
            <span class="grow"><b>{{ fullName(adding.person) }}</b> <span class="muted small">{{ lifespan(adding.person) }}</span></span>
            <button type="button" class="ghost small" @click="adding.person = null">Другой</button>
          </div>
          <template v-else>
            <input v-model="adding.find" placeholder="Начните вводить имя" aria-label="Найти человека" />
            <div v-if="found.length" class="list" style="margin-top:0.333rem">
              <button v-for="x in found" :key="x.id" type="button" @click="adding.person = x; adding.find = ''">
                <span class="grow">{{ fullName(x) }} <span class="muted small">{{ lifespan(x) }}</span></span>
              </button>
            </div>
            <div v-else-if="adding.find.trim().length >= 2" class="muted small" style="margin-top:0.333rem">В дереве никого не нашлось</div>
          </template>
        </div>
        <label class="field"><span>Что хотите узнать</span>
          <input v-model="adding.title" placeholder="например: родители, где погиб в 1943" :maxlength="QUESTION_MAX" /></label>
        <p v-if="adding.error" class="error">{{ adding.error }}</p>
        <div class="row">
          <button type="button" class="grow" @click="adding = null">Отмена</button>
          <button class="primary grow" :disabled="saving">{{ saving ? 'Сохраняю…' : 'Добавить вопрос' }}</button>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
.search { margin-top: 1rem; }
.filter { margin: 0.556rem 0 0.889rem; }
.filter button { flex: 1 1 auto; }
.group { margin-bottom: 1rem; }
.who { display: flex; align-items: center; gap: 0.667rem; color: inherit; text-decoration: none; padding: 0.222rem 0 0.444rem; }
.who .name { font-weight: 700; overflow-wrap: anywhere; }
.list > .item { align-items: flex-start; }
.item .title { display: block; font-weight: 700; overflow-wrap: anywhere; }
.item .grow > span { display: block; }
.tag { flex: none; font-size: 0.833rem; font-weight: 700; padding: 0.111rem 0.556rem; border-radius: 999px; background: var(--warn-bg); color: var(--warn-text); margin-top: 0.111rem; }
.tag.found { background: var(--accent-soft); color: var(--accent-text); }
.tag.notfound { background: var(--line); color: var(--muted); }
.how { display: grid; gap: 0.444rem; }
.picked { background: var(--accent-soft); border-radius: 12px; padding: 2px 4px 2px 12px; }
</style>
