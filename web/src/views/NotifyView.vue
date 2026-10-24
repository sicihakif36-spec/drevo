<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { toast } from '../store.js';
import { api } from '../api.js';
import { pushState, enablePush, disablePush, testPush } from '../push.js';

const OPTIONS = [
  ['comments', 'Обсуждение и вопросы родным', 'Сразу: новый комментарий, вопрос вам, ответ на ваш вопрос'],
  ['edits', 'Правки в дереве', 'Одной сводкой: кто сколько добавил и изменил'],
  ['dates', 'Дни рождения и памятные даты', 'В 9 утра по Москве, в сам день'],
];
const state = ref('');
const prefs = ref(null);
const busy = ref(false);

async function refresh() {
  state.value = await pushState();
}
const onShow = () => { if (!document.hidden) refresh(); };
onMounted(async () => {
  refresh();
  document.addEventListener('visibilitychange', onShow);
  try {
    prefs.value = await api('GET', '/api/push/settings');
  } catch (e) {
    toast(e.message);
  }
});
onUnmounted(() => document.removeEventListener('visibilitychange', onShow));

async function run(fn) {
  busy.value = true;
  try {
    await fn();
  } catch (e) {
    toast(e.message || 'Не получилось. Попробуйте ещё раз.');
  } finally {
    busy.value = false;
  }
}
const enable = () => run(async () => {
  state.value = await enablePush();
  if (state.value === 'on') toast('Уведомления включены');
});
const disable = () => run(async () => {
  await disablePush();
  await refresh();
  toast('Уведомления на этом телефоне выключены');
});
const test = () => run(async () => {
  const { sent } = await testPush();
  toast(sent ? 'Отправлено. Уведомление придёт через несколько секунд.' : 'Не удалось отправить. Попробуйте позже.');
});
async function toggle(key, on) {
  try {
    prefs.value = await api('PATCH', '/api/push/settings', { [key]: on });
  } catch (e) {
    toast(e.message);
    prefs.value = { ...prefs.value };
  }
}
</script>

<template>
  <div class="page">
    <h1>Уведомления</h1>

    <div class="card status">
      <div v-if="!state" class="muted">Проверяем…</div>
      <template v-else-if="state === 'on'">
        <p class="big"><span class="ok">✓</span> На этом телефоне уведомления включены</p>
        <button class="block" :disabled="busy" @click="test">Прислать проверочное</button>
        <button class="danger block" :disabled="busy" @click="disable">Выключить на этом телефоне</button>
      </template>
      <template v-else-if="state === 'off'">
        <p class="big">На этом телефоне уведомления выключены</p>
        <p>Телефон сообщит о новых комментариях, правках родственников и днях рождения, даже когда приложение закрыто.</p>
        <button class="primary block" :disabled="busy" @click="enable">Включить уведомления на этом телефоне</button>
      </template>
      <template v-else-if="state === 'denied'">
        <p class="big">Уведомления запрещены в настройках браузера</p>
        <p>Откройте настройки браузера или телефона, найдите там этот сайт и разрешите уведомления. Потом вернитесь на этот экран.</p>
      </template>
      <template v-else-if="state === 'ios'">
        <p class="big">На iPhone уведомления приходят, только если Древо добавлено на экран «Домой»</p>
        <ol>
          <li>В Safari нажмите «Поделиться» (квадрат со стрелкой).</li>
          <li>Выберите «На экран „Домой“».</li>
          <li>Откройте Древо со значка на экране и вернитесь сюда.</li>
        </ol>
        <p class="muted">Нужен iOS 16.4 или новее.</p>
      </template>
      <template v-else>
        <p class="big">Этот браузер не умеет присылать уведомления</p>
        <p class="muted">Попробуйте Chrome или Яндекс Браузер. На iPhone — Safari, добавив Древо на экран «Домой» (iOS 16.4 или новее).</p>
      </template>
    </div>

    <template v-if="prefs">
      <h2>О чём сообщать</h2>
      <div class="list">
        <label v-for="[key, title, hint] in OPTIONS" :key="key" class="opt">
          <div class="grow">
            <div>{{ title }}</div>
            <div class="small muted">{{ hint }}</div>
          </div>
          <input type="checkbox" :checked="prefs[key]" @change="toggle(key, $event.target.checked)" />
        </label>
      </div>
      <p class="small muted">Эти настройки действуют на всех ваших телефонах.</p>
    </template>
  </div>
</template>

<style scoped>
.status p { margin: 0 0 0.667rem; }
.status button + button { margin-top: 0.444rem; }
.status ol { margin: 0 0 12px; padding-left: 22px; }
.status li { margin-bottom: 4px; }
.big { font-size: 1.056rem; font-weight: 700; }
.ok { color: var(--accent-text); }
.opt { cursor: pointer; }
.opt input { width: 1.556rem; height: 1.556rem; min-height: 0; flex: none; margin: 0; }
</style>
