<script setup>
// Пароль владельца и участника. mode: enter — вход на новом телефоне ждёт пароль; create — придумать (первый раз);
// change — сменить (старый и новый). Пароль нужен, только когда входят с нового телефона.
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { store, loadMe, loadTree, toast, forget } from '../store.js';
import { passwordProblem, MIN_PASSWORD } from '@shared/password.js';

const props = defineProps({ mode: { type: String, default: 'change' }, later: Boolean });
const emit = defineEmits(['later']);
const router = useRouter();
const password = ref('');
const old = ref('');
// Придумывая пароль, его видно: второго поля «повторите» нет, опечатку видно сразу.
const shown = ref(props.mode !== 'enter');
const error = ref('');
const busy = ref(false);
const creating = computed(() => props.mode !== 'enter');
const problem = computed(() => (password.value ? passwordProblem(password.value) : ''));
const ok = computed(() => (creating.value ? password.value && !problem.value : password.value));

async function save() {
  if (!ok.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (props.mode === 'enter') {
      await api('POST', '/api/login/password', { password: password.value });
      // Сначала на главную, потом показать: иначе переход догонит человека, уже открывшего другой экран.
      await router.replace('/');
      await loadMe();
      await loadTree();
    } else {
      await api('POST', '/api/me/password', { password: password.value, old: old.value || undefined });
      await loadMe();
      await loadTree();
      toast(props.mode === 'change' ? 'Пароль изменён. На других устройствах войти нужно будет заново.' : 'Пароль сохранён. Теперь можно править дерево.');
      if (props.mode === 'change' || router.currentRoute.value.path === '/password') router.replace('/devices');
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

async function leave() {
  await api('POST', '/api/logout').catch(() => {});
  forget();
  location.replace('/');
}
</script>

<template>
  <div class="page">
    <template v-if="mode === 'enter'">
      <h1>Введите пароль</h1>
      <p>{{ store.pending?.name }}, вы входите на новом телефоне. Введите пароль, который вы придумали для «Древа».</p>
    </template>
    <template v-else-if="mode === 'create'">
      <h1>Придумайте пароль</h1>
      <p>Он нужен, только когда вы входите с нового телефона. На этом телефоне вводить его не придётся.</p>
    </template>
    <h1 v-else>Сменить пароль</h1>

    <form class="card" @submit.prevent="save">
      <label v-if="mode === 'change'" class="field"><span>Нынешний пароль</span>
        <input v-model="old" :type="shown ? 'text' : 'password'" autocomplete="current-password" autocapitalize="off" spellcheck="false" />
      </label>
      <label class="field"><span>{{ mode === 'enter' ? 'Пароль' : mode === 'change' ? 'Новый пароль' : 'Пароль' }}</span>
        <input v-model="password" :type="shown ? 'text' : 'password'" :autocomplete="creating ? 'new-password' : 'current-password'"
          autocapitalize="off" spellcheck="false" autofocus />
      </label>
      <button type="button" class="ghost show" @click="shown = !shown">{{ shown ? 'Скрыть пароль' : 'Показать пароль' }}</button>
      <template v-if="creating">
        <p v-if="problem" class="hint bad">{{ problem }}</p>
        <p v-else-if="password" class="hint good">Подходит</p>
        <p class="muted small">Не короче {{ MIN_PASSWORD }} знаков. Подойдут несколько слов, понятных только вам,
          например «бабушкин сад у реки». Не годятся простые: 12345678, qwerty, одна и та же буква.</p>
        <p class="muted small">Запишите пароль на бумаге и храните дома.</p>
      </template>
      <p class="error" v-if="error">{{ error }}</p>
      <button class="primary block" :disabled="!ok || busy">{{ busy ? 'Минутку…' : mode === 'enter' ? 'Войти' : 'Сохранить пароль' }}</button>
    </form>

    <template v-if="mode === 'enter'">
      <p class="muted small">Забыли пароль? Попросите у того, кто ведёт дерево, новую ссылку: он сбросит пароль, и вы придумаете новый.</p>
      <button class="ghost block" @click="leave">Не входить</button>
    </template>
    <template v-else-if="later">
      <p class="muted small">Без пароля дерево можно смотреть, но не править.</p>
      <button class="ghost block" @click="emit('later')">Пока только смотреть</button>
    </template>
  </div>
</template>

<style scoped>
.show { margin: -0.333rem 0 0.333rem; padding-left: 0; padding-right: 0; color: var(--accent-text); }
.hint { font-weight: 700; margin: 0.333rem 0; }
.hint.bad { color: var(--danger); }
.hint.good { color: var(--accent-text); }
</style>
