<script setup>
import { onUnmounted, ref } from 'vue';
import AudioPlayer from './AudioPlayer.vue';
import { ask } from './ask.js';

// Запись голоса с телефона или готовая запись из диктофона. Наружу — { blob, name, duration } или null (записи нет).
// Микрофон просим только по нажатию «Записать». Запись не длиннее 15 минут: потом останавливается сама.
const emit = defineEmits(['change']);
const LIMIT = 15 * 60;
const MAX = 20 * 1024 * 1024; // как на сервере
// Сначала mp4 (AAC): его играют и Android, и iPhone. Иначе webm — так пишет Chrome на Android и Firefox.
const TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

const state = ref('idle'); // idle — ничего, asking — ждём разрешения, recording, done — есть запись
const seconds = ref(0);
const url = ref('');
const duration = ref(0);
const error = ref('');
const note = ref('');
const fileInput = ref(null);
let rec = null;
let stream = null;
let timer = null;
let started = 0;
let gone = false; // экран закрыли, пока ждали разрешения на микрофон

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function release() {
  clearInterval(timer);
  timer = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function show(blob, name, sec) {
  if (url.value) URL.revokeObjectURL(url.value);
  url.value = URL.createObjectURL(blob);
  duration.value = sec;
  state.value = 'done';
  emit('change', { blob, name, duration: sec });
}

async function start() {
  error.value = '';
  note.value = '';
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    error.value = 'Этот телефон не умеет записывать голос в браузере. Запишите в диктофоне и нажмите «Выбрать готовую запись».';
    return;
  }
  state.value = 'asking';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    state.value = url.value ? 'done' : 'idle';
    error.value = e.name === 'NotAllowedError'
      ? 'Нет доступа к микрофону. Разрешите его для этого сайта в настройках браузера и нажмите «Записать» ещё раз.'
      : 'Не удалось включить микрофон.';
    return;
  }
  if (gone) {
    release();
    return;
  }
  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const chunks = [];
  rec = new MediaRecorder(stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 64000 });
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const sec = Math.max(1, Math.round((Date.now() - started) / 1000));
    release();
    const type = (rec.mimeType || mimeType || 'audio/webm').split(';')[0];
    rec = null;
    if (!chunks.length) {
      state.value = 'idle';
      error.value = 'Запись не получилась. Попробуйте ещё раз.';
      return;
    }
    show(new Blob(chunks, { type }), `golos.${type.includes('mp4') ? 'm4a' : type.split('/')[1]}`, Math.min(sec, LIMIT));
  };
  rec.start(1000);
  started = Date.now();
  seconds.value = 0;
  state.value = 'recording';
  emit('change', null);
  timer = setInterval(() => {
    seconds.value = Math.floor((Date.now() - started) / 1000);
    if (seconds.value >= LIMIT) {
      note.value = 'Прошло 15 минут — запись остановлена. Сохраните её, а продолжение запишите в новой истории.';
      stop();
    }
  }, 250);
}

function stop() {
  clearInterval(timer);
  if (rec?.state === 'recording') rec.stop();
}

async function again() {
  if (await ask({ text: 'Записать заново?', note: 'Эта запись пропадёт.', yes: 'Записать заново', no: 'Оставить эту' })) start();
}
// Новая запись ещё нигде не сохранена: убрать её — насовсем, поэтому спрашиваем.
async function clear() {
  if (!await ask({ text: 'Убрать эту запись?', note: 'Она ещё не сохранена, вернуть её будет нельзя.', yes: 'Убрать', no: 'Не убирать', danger: true })) return;
  if (url.value) URL.revokeObjectURL(url.value);
  url.value = '';
  state.value = 'idle';
  note.value = '';
  emit('change', null);
}

// Готовая запись: длительность узнаём у браузера, файл не больше 20 МБ.
function pick(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  error.value = '';
  note.value = '';
  if (file.size > MAX) {
    error.value = 'Запись больше 20 МБ. Выберите покороче или запишите по частям.';
    return;
  }
  const probe = new Audio();
  const src = URL.createObjectURL(file);
  const done = (sec) => {
    URL.revokeObjectURL(src);
    show(file, file.name, Number.isFinite(sec) && sec > 0 ? Math.round(sec) : 0);
  };
  probe.onloadedmetadata = () => done(probe.duration);
  probe.onerror = () => done(0);
  probe.preload = 'metadata';
  probe.src = src;
}

onUnmounted(() => {
  gone = true;
  if (rec) {
    rec.onstop = null;
    if (rec.state === 'recording') rec.stop();
  }
  release();
  if (url.value) URL.revokeObjectURL(url.value);
});
</script>

<template>
  <div class="recorder">
    <template v-if="state === 'recording'">
      <div class="live" role="status">
        <span class="dot" />
        <span class="time">{{ clock(seconds) }}</span>
        <span class="muted small">из 15:00</span>
      </div>
      <button type="button" class="stop block" @click="stop">■ Стоп</button>
    </template>
    <template v-else-if="state === 'done'">
      <AudioPlayer :src="url" :duration="duration" />
      <div class="row">
        <button type="button" class="grow" @click="again">Перезаписать</button>
        <button type="button" class="danger" @click="clear">Убрать запись</button>
      </div>
    </template>
    <template v-else>
      <button type="button" class="rec block" :disabled="state === 'asking'" @click="start">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" /></svg>
        {{ state === 'asking' ? 'Включаю микрофон…' : 'Записать голос' }}
      </button>
      <button type="button" class="ghost block" @click="fileInput.click()">Выбрать готовую запись</button>
    </template>
    <p v-if="note" class="banner">{{ note }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <input ref="fileInput" type="file" accept="audio/*,.m4a,.mp3,.ogg,.opus,.webm,.wav" hidden @change="pick" />
  </div>
</template>

<style scoped>
.recorder { display: flex; flex-direction: column; gap: 0.556rem; }
.rec, .stop { min-height: 4rem; font-size: 1.111rem; font-weight: 700; }
.rec { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.rec svg { width: 1.556rem; height: 1.556rem; fill: currentColor; }
.recorder .ghost { color: var(--accent-text); }
.stop { background: var(--text); border-color: var(--text); color: var(--bg); }
.live { display: flex; align-items: center; justify-content: center; gap: 0.556rem; padding: 0.333rem 0; }
.dot { width: 0.889rem; height: 0.889rem; border-radius: 50%; background: var(--danger); animation: blink 1s infinite; }
.time { font-size: 1.778rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.banner { margin: 0; }
.error { margin: 0; }
@keyframes blink { 50% { opacity: .25; } }
</style>
