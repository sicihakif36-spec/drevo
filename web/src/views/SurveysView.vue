<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { store, onLive } from '../store.js';
import { api } from '../api.js';
import { fullName, lifespan, personHas } from '@shared/names.js';
import { STATUS, shareSurvey } from '../surveys.js';

// Анкеты для родственников, которые приложением не пользуются: ссылка в мессенджер, ответы — в дерево.
const router = useRouter();
const list = ref(null);
const name = ref('');
const personId = ref(null);
const find = ref('');
const link = ref(null);
const error = ref('');

const load = async () => { list.value = await api('GET', '/api/surveys'); };
onMounted(load);
onUnmounted(onLive(load));

const person = computed(() => store.idx?.persons.get(personId.value));
const candidates = computed(() => {
  const s = find.value.trim().toLowerCase();
  if (s.length < 2) return [];
  return [...(store.idx?.persons.values() || [])].filter((p) => personHas(p, s)).slice(0, 6);
});
function pick(p) {
  personId.value = p.id;
  find.value = '';
  if (!name.value.trim()) name.value = [p.given, p.patronymic].filter(Boolean).join(' ');
}

async function create() {
  error.value = '';
  try {
    const s = await api('POST', '/api/surveys', { name: name.value, person_id: personId.value });
    link.value = { ...s, name: name.value };
    name.value = '';
    personId.value = null;
    load();
  } catch (e) {
    error.value = e.message;
  }
}
// Пустой бланк на бумаге: опросить за чаем, потом перенести ответы в анкету.
const blankName = ref('');
const blankUrl = (download) => `/api/survey-blank.pdf?${new URLSearchParams({ name: blankName.value.trim(), ...(download ? { download: '1' } : {}) })}`;
const when = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
</script>

<template>
  <div class="page">
    <h1>Анкеты</h1>
    <p class="muted small">Для родственника, который приложением не пользуется: он заполнит анкету по ссылке, без входа, а вы загрузите ответы в дерево.
      Анкета не показывает ничего из дерева.</p>

    <div class="card">
      <b>Новая анкета</b>
      <label class="field"><span>Для кого (видите только вы, например «Тётя Валя»)</span><input v-model="name" maxlength="80" /></label>
      <div class="field">
        <span>Кто это в дереве (можно не указывать)</span>
        <p class="muted small hint">Тогда ответы сразу привяжутся к нему.</p>
        <div v-if="person" class="row picked">
          <span class="grow">{{ fullName(person) }} <span class="muted small">{{ lifespan(person) }}</span></span>
          <button class="ghost" @click="personId = null">Убрать</button>
        </div>
        <template v-else>
          <input v-model="find" placeholder="Начните вводить имя" />
          <div v-if="candidates.length" class="list" style="margin-top:6px">
            <a v-for="p in candidates" :key="p.id" href="#" @click.prevent="pick(p)">{{ fullName(p) }} <span class="muted small">{{ lifespan(p) }}</span></a>
          </div>
        </template>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="primary block" :disabled="!name.trim()" @click="create">Создать ссылку</button>
    </div>

    <div v-if="link" class="card" style="margin-top:12px">
      <b>Ссылка для: {{ link.name }}</b>
      <p class="small" style="word-break:break-all">{{ link.url }}</p>
      <p class="muted small">Работает 30 дней и пока анкету не отправили. Отправьте её в любом мессенджере.</p>
      <div class="grid2">
        <button class="primary" @click="shareSurvey(link, 'share')">Поделиться</button>
        <button @click="shareSurvey(link, 'copy')">Скопировать</button>
      </div>
    </div>

    <div class="card" style="margin-top:12px">
      <b>Бумажный бланк</b>
      <p class="muted small" style="margin:4px 0 0">Те же вопросы на листах A4 с линиями — чтобы расспросить родственника за чаем.
        Потом создайте анкету, заполните её по ссылке сами по бланку и загрузите в дерево.</p>
      <label class="field"><span>Кого опрашиваем (необязательно, будет в шапке)</span><input v-model="blankName" maxlength="80" /></label>
      <div class="row wrap">
        <a class="btn primary grow" :href="blankUrl(false)" target="_blank">Напечатать пустой бланк</a>
        <a class="btn grow" :href="blankUrl(true)">Скачать</a>
      </div>
    </div>

    <h2>Отправленные</h2>
    <div v-if="!list" class="muted">Загрузка…</div>
    <div v-else class="list">
      <router-link v-for="s in list" :key="s.id" :to="`/surveys/${s.id}`">
        <div class="grow">
          <div class="name">{{ s.name }}</div>
          <div class="small"><span class="status" :class="s.status">{{ STATUS[s.status] }}</span>
            <span class="muted"> · {{ s.created_by_name }}, {{ when(s.created_at) }}</span></div>
        </div>
        <span class="muted">›</span>
      </router-link>
      <div v-if="!list.length" class="muted">Анкет пока нет</div>
    </div>
  </div>
</template>

<style scoped>
.picked { background: var(--accent-soft); color: var(--accent-soft-text); border-radius: var(--radius-s); padding: 0.222rem 0.222rem 0.222rem 0.667rem; }
.picked .ghost { color: var(--accent-soft-text); }
.hint { margin: 0 0 0.333rem; }
.name { overflow-wrap: anywhere; }
.status { font-weight: 700; color: var(--muted); }
.status.submitted { color: var(--accent-text); }
.status.filling { color: var(--oral); }
.status.loaded { color: var(--text); font-weight: 400; }
</style>
