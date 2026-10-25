<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { store } from '../store.js';
import { api } from '../api.js';
import { sizeText } from '../size.js';
import { lastText, KEEP_HINT } from '@shared/archive.js';

// «Скачать всё» — владельцу (server/src/routes/archive.js): сначала — сколько весит архив, потом скачивание обычной ссылкой
// (браузер сам покажет ход). Сюда ведут плитка на «Главной», плашка «Пора сохранить семейный архив» и уведомление.
const BIG = 200 * 1024 * 1024;
const archive = ref({ loading: true });
const error = ref('');
onMounted(async () => {
  try {
    archive.value = await api('GET', '/api/archive');
  } catch (e) {
    error.value = e.message;
  }
});
// Пока идёт скачивание, раз в 5 секунд спрашиваем, не дошло ли оно до конца: тогда «в последний раз» обновится.
let watch = null;
const stopWatch = () => { clearInterval(watch); watch = null; };
onUnmounted(stopWatch);
function startDownload() {
  const a = archive.value;
  a.started = true;
  const was = a.last?.at;
  const until = Date.now() + 30 * 60000;
  stopWatch();
  watch = setInterval(async () => {
    if (Date.now() > until) return stopWatch();
    const { last } = await api('GET', '/api/archive/last').catch(() => ({}));
    if (last && last.at !== was) {
      archive.value = { ...archive.value, last, done: true };
      stopWatch();
    }
  }, 5000);
}
</script>

<template>
  <div class="page">
    <h1>Скачать всё</h1>
    <p>Один архив со всем деревом: люди, фото, документы, истории, записи голоса, журнал поиска,
      вопросы родным и черновики интервью.
      Это копия на случай, если с сервером что-то случится, и способ перенести дерево в другую программу.</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="archive.loading" class="muted">Считаю, сколько весит архив…</p>
    <div v-else class="card">
      <p>В архиве: {{ archive.summary }}.<br />Весит примерно <b>{{ sizeText(archive.bytes) }}</b>.</p>
      <p v-if="archive.missing" class="small muted">Не нашлось на сервере файлов: {{ archive.missing }}. Их в архиве не будет.</p>
      <p v-if="archive.bytes > BIG" class="small"><b>Архив большой.</b> Лучше скачивать с компьютера или по Wi-Fi,
        а на телефоне проверьте, хватит ли места.</p>
      <p class="last" :class="{ done: archive.done }">
        <template v-if="archive.done">Архив скачан. Теперь сохраните его у себя.</template>
        <template v-else-if="archive.last">В последний раз {{ archive.last.name && archive.last.name !== store.me.name ? `архив скачивал(а) ${archive.last.name}` : 'вы скачивали' }} {{ lastText(archive.last.at) }}.</template>
        <template v-else>Вы ещё ни разу не скачивали архив.</template>
      </p>
      <a class="btn primary block" href="/api/archive.zip" download @click="startDownload">Скачать архив</a>
      <p v-if="archive.started && !archive.done" class="small">Скачивание началось. Ход виден в браузере, в списке загрузок.</p>
      <p class="small">{{ KEEP_HINT }}</p>
      <p class="small muted">После скачивания распакуйте архив и откройте файл index.html — дерево откроется в браузере без интернета.</p>
    </div>
  </div>
</template>

<style scoped>
.card p { margin: 0 0 0.667rem; }
.card p:last-child { margin-bottom: 0; }
.last { margin: 0.667rem 0; }
.last.done { color: var(--accent-text); font-weight: 700; }
</style>
