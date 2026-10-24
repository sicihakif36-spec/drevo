<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { api, upload, shrinkImage } from '../api.js';
import { toast } from '../store.js';
import { useRecorder, leftovers, forget, clock } from '../recorder.js';
import { IV_NOTE, IV_OWN, IV_PHOTOS, IV_LIMIT, topicTitle, hasAnswer } from '@shared/interview.js';
import AudioPlayer from './AudioPlayer.vue';
import { ask } from './ask.js';

// Интервью по шагам: вопрос крупно, «Записать» — «Остановить» — «Переписать», «Пропустить», «Назад», «Дальше».
// Каждый ответ сразу уходит на сервер: в приложении (base — /api/interviews/<id>) и по ссылке (base — /api/interview, headers — ключ).
// scope — где в памяти телефона отложена запись, которая не успела отправиться (recorder.js).
const props = defineProps({
  base: String, headers: { type: Object, default: () => ({}) }, data: Object, scope: String,
  link: Boolean, // по ссылке: без «Сохранить в истории»
});
const H = props.headers;
const questions = ref(props.data.questions);
const answers = reactive(Object.fromEntries(Object.entries(props.data.answers).map(([k, a]) => [k, { ...a, files: [...a.files] }])));
const i = ref(Math.min(props.data.pos, questions.value.length));
const rec = useRecorder();
const sending = ref(''); // ход отправки записи
const failed = ref(null); // { qkey, take } — запись не отправилась, можно ещё раз
const left = ref([]); // отложенные записи прошлого раза
const note = ref('');
const noteOpen = ref(false);
const photoBusy = ref('');
const error = ref('');
const ownOpen = ref(false);
const ownText = ref('');
const listOpen = ref(false);
const urls = new Map(); // файлы по ссылке приходят через fetch с ключом в заголовке — показываем через object URL
const shown = reactive({});
let pending = null; // идущая запись и её отправка: «Дальше» дожидается их

const q = computed(() => questions.value[i.value] || null);
const a = computed(() => (q.value && answers[q.value.key]) || { skipped: false, note: '', files: [] });
const voice = computed(() => a.value.files.find((f) => f.kind === 'audio'));
const photos = computed(() => a.value.files.filter((f) => f.kind === 'photo'));
const recording = computed(() => rec.state.value === 'recording');
const busy = computed(() => rec.state.value !== 'idle' || Boolean(sending.value));
const answered = computed(() => questions.value.filter((x) => hasAnswer(answers[x.key])).length);
const skipped = computed(() => questions.value.filter((x) => answers[x.key]?.skipped).length);
const enc = encodeURIComponent;

const fileUrl = (f, full = false) => {
  const u = `${props.base}/files/${f.id}${full ? '?full' : ''}`;
  if (!props.link) return u;
  const k = u;
  if (!urls.has(k)) {
    urls.set(k, '');
    fetch(u, { headers: H }).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (b) urls.set(k, (shown[k] = URL.createObjectURL(b)));
    }).catch(() => {});
  }
  return shown[k] || '';
};
onUnmounted(() => { for (const u of urls.values()) if (u) URL.revokeObjectURL(u); });

const at = (k) => (answers[k] ??= { skipped: false, note: '', files: [] });

watch(q, (x) => {
  note.value = x ? at(x.key).note : '';
  noteOpen.value = Boolean(note.value);
  error.value = '';
  window.scrollTo(0, 0);
}, { immediate: true });

// Прошлый раз запись не успела отправиться — предложить досохранить.
onMounted(async () => {
  const keys = new Set(questions.value.map((x) => `${props.scope}:${x.key}`));
  left.value = (await leftovers(`${props.scope}:`)).filter((x) => keys.has(x.key));
});

async function send(qkey, take) {
  sending.value = 'Сохраняю запись…';
  failed.value = null;
  try {
    const fd = new FormData();
    fd.append('file', take.blob, take.name);
    const f = await upload(`${props.base}/answers/${enc(qkey)}/files`, fd, (x) => {
      sending.value = x < 1 ? `Сохраняю запись… ${Math.round(x * 100)}%` : 'Сохраняю запись…';
    }, H);
    const ans = at(qkey);
    ans.files = [...ans.files.filter((x) => x.kind !== 'audio'), f];
    ans.skipped = false;
    await forget(`${props.scope}:${qkey}`);
    return true;
  } catch (e) {
    failed.value = { qkey, take };
    error.value = `${e.message} Запись не пропала: нажмите «Отправить ещё раз».`;
    return false;
  } finally {
    sending.value = '';
  }
}

async function record() {
  const key = q.value.key;
  pending = (async () => {
    const take = await rec.start(`${props.scope}:${key}`);
    if (take) await send(key, take);
  })();
  await pending;
  pending = null;
}
async function rerecord() {
  if (await ask({ text: 'Записать ответ заново?', note: 'Прежняя запись заменится новой, когда та сохранится.', yes: 'Записать заново', no: 'Оставить прежнюю' })) record();
}
async function retry() {
  const f = failed.value;
  if (f) await send(f.qkey, f.take);
}

async function saveLeft(x) {
  const qkey = x.key.slice(props.scope.length + 1);
  const had = answers[qkey]?.files.some((f) => f.kind === 'audio');
  if (had && !await ask({ text: 'Сохранить эту запись?', note: 'На этот вопрос уже есть запись — она заменится.', yes: 'Сохранить', no: 'Не сохранять' })) return;
  if (await send(qkey, x)) {
    left.value = left.value.filter((y) => y !== x);
    toast('Запись сохранена');
  }
}
async function dropLeft(x) {
  if (!await ask({ text: 'Удалить несохранённую запись?', note: 'Вернуть её будет нельзя.', yes: 'Удалить', no: 'Не удалять', danger: true })) return;
  await forget(x.key);
  left.value = left.value.filter((y) => y !== x);
}
const leftTitle = (x) => questions.value.find((y) => `${props.scope}:${y.key}` === x.key)?.text || '';

// Заметка сохраняется сама: когда ушли с поля и через пару секунд после набора.
let noteTimer = null;
async function saveNote() {
  clearTimeout(noteTimer);
  if (!q.value) return;
  const key = q.value.key;
  const text = note.value.trim();
  if (text === (answers[key]?.note || '')) return;
  try {
    const r = await api('PUT', `${props.base}/answers/${enc(key)}`, { note: text }, H);
    at(key).note = r.note;
  } catch (e) { error.value = e.message; }
}
watch(note, () => {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(saveNote, 2000);
});

async function addPhotos(e) {
  const list = [...e.target.files].slice(0, IV_PHOTOS - photos.value.length);
  e.target.value = '';
  error.value = '';
  const key = q.value.key;
  for (const [n, file] of list.entries()) {
    photoBusy.value = list.length > 1 ? `Отправляю фото ${n + 1} из ${list.length}…` : 'Отправляю фото…';
    try {
      const img = await shrinkImage(file, [[1600, 0.86], [400, 0.8]]);
      const fd = new FormData();
      fd.append('file', img ? new File([img[0]], 'foto.jpg', { type: 'image/jpeg' }) : file);
      if (img) fd.append('thumb', new File([img[1]], 'thumb.jpg', { type: 'image/jpeg' }));
      const f = await upload(`${props.base}/answers/${enc(key)}/files`, fd, null, H);
      at(key).files.push(f);
    } catch (err) {
      error.value = err.message;
      break;
    }
  }
  photoBusy.value = '';
}
async function dropPhoto(f) {
  if (!await ask({ text: 'Убрать это фото?', yes: 'Убрать', no: 'Не убирать', danger: true })) return;
  try {
    await api('DELETE', `${props.base}/files/${f.id}`, undefined, H);
    const ans = at(q.value.key);
    ans.files = ans.files.filter((x) => x.id !== f.id);
  } catch (e) { error.value = e.message; }
}

async function go(n) {
  if (recording.value) rec.stop();
  if (pending) await pending;
  await saveNote();
  const forward = n > i.value && q.value && hasAnswer(answers[q.value.key]);
  i.value = Math.max(0, Math.min(questions.value.length, n));
  api('PATCH', props.base, { pos: i.value }, H).catch(() => {});
  if (forward && q.value) toast('Сохранено. Следующий вопрос');
}
const next = () => go(i.value + 1);
async function skip() {
  try {
    const key = q.value.key;
    const r = await api('PUT', `${props.base}/answers/${enc(key)}`, { skipped: true }, H);
    at(key).skipped = r.skipped;
    go(i.value + 1);
  } catch (e) { error.value = e.message; }
}

// Свой вопрос — сразу после этого.
async function addOwn(text = ownText.value) {
  const t = text.trim();
  if (!t) return;
  try {
    const r = await api('POST', `${props.base}/questions`, { text: t, after: Math.min(i.value, questions.value.length - 1) }, H);
    questions.value = r.questions;
    ownText.value = '';
    ownOpen.value = false;
    await go(r.index);
  } catch (e) { error.value = e.message; }
}
// 20 минут прошло — продолжение рассказа отдельным вопросом.
const goOn = () => addOwn(`${q.value.text.replace(/\s*\(продолжение\)$/, '')} (продолжение)`);

const mark = (x) => (hasAnswer(answers[x.key]) ? '✓' : answers[x.key]?.skipped ? '—' : '');
defineExpose({ go, answered, skipped, questions });
</script>

<template>
  <div class="runner">
    <div v-for="x in left" :key="x.key" class="banner left">
      <div><b>Запись не успела сохраниться</b> — ответ на вопрос «{{ leftTitle(x) }}».</div>
      <div class="row">
        <button class="primary grow" :disabled="busy" @click="saveLeft(x)">Сохранить её</button>
        <button class="ghost danger" @click="dropLeft(x)">Удалить</button>
      </div>
    </div>

    <template v-if="q">
      <div class="where">
        <span>Вопрос {{ i + 1 }} из {{ questions.length }}</span>
        <span class="muted"> · {{ topicTitle(q.topic) }}</span>
      </div>
      <div class="bar" aria-hidden="true"><span :style="{ width: `${(i / questions.length) * 100}%` }" /></div>

      <p class="question">{{ q.text }}</p>

      <div class="card take">
        <template v-if="recording">
          <div class="live" role="status"><span class="dot" />Запись идёт — {{ clock(rec.seconds.value) }}</div>
          <button class="stop block" @click="rec.stop()">■ Остановить</button>
          <p class="muted small center">Не выключайте экран и не сворачивайте приложение. Запись — до {{ IV_LIMIT / 60 }} минут.</p>
        </template>
        <template v-else-if="sending">
          <div class="live">{{ sending }}</div>
        </template>
        <template v-else-if="voice">
          <div class="ok">✓ Ответ записан и сохранён</div>
          <AudioPlayer :key="voice.id" :src="fileUrl(voice)" :duration="voice.duration" />
          <button class="block" @click="rerecord">Переписать</button>
        </template>
        <template v-else>
          <p class="hint center">{{ rec.state.value === 'asking' ? 'Включаю микрофон…' : 'Нажмите «Записать» и расскажите' }}</p>
          <button class="rec block" :disabled="rec.state.value === 'asking'" @click="record">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" /></svg>
            Записать
          </button>
          <p v-if="a.skipped" class="muted small center">Этот вопрос пропущен.</p>
        </template>
        <p v-if="rec.cut.value && !recording && voice" class="banner">
          {{ rec.cut.value === 'time' ? `Прошло ${IV_LIMIT / 60} минут — запись остановлена и сохранена.` : 'Запись стала очень большой — она остановлена и сохранена.' }}
          <button class="block cont" @click="goOn">Продолжить рассказ</button>
        </p>
        <p v-if="rec.error.value" class="error">{{ rec.error.value }}</p>
        <p v-if="error" class="error">{{ error }}</p>
        <button v-if="failed && !sending" class="primary block" @click="retry">Отправить ещё раз</button>
      </div>

      <div v-if="!recording" class="extra">
        <label v-if="noteOpen" class="field"><span>Заметка к ответу</span>
          <textarea v-model="note" :maxlength="IV_NOTE" rows="3" placeholder="Например: имена, даты, места, о которых шла речь" @blur="saveNote" />
        </label>
        <div v-if="photos.length" class="thumbs">
          <div v-for="f in photos" :key="f.id" class="thumb">
            <img v-if="fileUrl(f)" :src="fileUrl(f)" alt="" />
            <div v-else class="noimg muted small">фото</div>
            <button class="ghost danger small" @click="dropPhoto(f)">Убрать</button>
          </div>
        </div>
        <p v-if="photoBusy" class="muted">{{ photoBusy }}</p>
        <div class="row wrap tools">
          <button v-if="!noteOpen" class="ghost grow" @click="noteOpen = true">+ Заметка</button>
          <label v-if="photos.length < IV_PHOTOS && !photoBusy" class="btn ghost grow">
            + Фото
            <input type="file" accept="image/*" multiple hidden @change="addPhotos" />
          </label>
        </div>
      </div>

      <div class="steps">
        <button class="primary next" :disabled="sending !== '' || rec.state.value === 'asking'" @click="next">
          {{ i === questions.length - 1 ? 'Готово' : 'Дальше ›' }}
        </button>
        <button class="grow" :disabled="i === 0 || busy" @click="go(i - 1)">‹ Назад</button>
        <button v-if="!hasAnswer(a) && !a.skipped && !recording" class="grow" :disabled="busy" @click="skip">Пропустить</button>
      </div>

      <div class="more">
        <button class="ghost small" @click="listOpen = !listOpen">{{ listOpen ? 'Скрыть вопросы' : 'Все вопросы' }}</button>
        <button class="ghost small" @click="ownOpen = !ownOpen">+ Свой вопрос</button>
      </div>
      <div v-if="ownOpen" class="card own">
        <label class="field"><span>Свой вопрос — будет следующим</span>
          <textarea v-model="ownText" :maxlength="IV_OWN" rows="2" placeholder="Например: Как звали вашу первую учительницу?" />
        </label>
        <button class="primary block" :disabled="!ownText.trim()" @click="addOwn()">Добавить вопрос</button>
      </div>
    </template>

    <!-- Дошли до конца: что дальше — решает тот, кто показывает интервью. -->
    <slot v-if="!q" name="done" :answered="answered" :skipped="skipped" :total="questions.length" />

    <h2 v-if="!q">Все вопросы</h2>
    <div v-if="listOpen || !q" class="list qs">
      <button v-for="(x, n) in questions" :key="x.key" :class="{ cur: n === i }" :disabled="busy" @click="listOpen = false; go(n)">
        <span class="no">{{ n + 1 }}</span>
        <span class="grow">{{ x.text }}</span>
        <span class="mark" :class="{ yes: mark(x) === '✓' }">{{ mark(x) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.where { font-size: 0.889rem; font-weight: 700; }
.bar { height: 6px; border-radius: 3px; background: var(--line); margin: 0.333rem 0 0.889rem; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent); }
.question { font-size: 1.556rem; line-height: 1.3; font-weight: 700; margin: 0 0 1rem; overflow-wrap: anywhere; }
.take { display: flex; flex-direction: column; gap: 0.667rem; }
.rec, .stop { min-height: 4.444rem; font-size: 1.333rem; font-weight: 700; }
.rec { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.rec svg { width: 1.778rem; height: 1.778rem; fill: currentColor; }
.stop { background: var(--text); border-color: var(--text); color: var(--bg); }
.live { display: flex; align-items: center; justify-content: center; gap: 0.556rem; font-size: 1.333rem; font-weight: 700; font-variant-numeric: tabular-nums; padding: 0.333rem 0; }
.dot { width: 0.889rem; height: 0.889rem; border-radius: 50%; background: var(--danger); animation: blink 1s infinite; }
.ok { font-weight: 700; color: var(--accent-text); }
.hint { margin: 0; font-size: 1.111rem; }
.center { text-align: center; margin: 0; }
.take .error, .take .banner { margin: 0; }
.cont { margin-top: 0.444rem; }
.extra { margin-top: 0.667rem; }
.tools .btn.ghost, .tools button.ghost { color: var(--accent-text); border-color: transparent; background: transparent; }
.thumbs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.444rem; margin-bottom: 0.444rem; }
.thumb { display: grid; gap: 0.111rem; }
.thumb img, .noimg { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 0.556rem; background: var(--line); display: grid; place-items: center; }
.thumb .ghost { min-height: 2.444rem; padding: 0; }
.steps { display: flex; flex-wrap: wrap; gap: 0.444rem; margin-top: 1rem; }
.steps button { min-height: 3.333rem; font-size: 1.056rem; padding: 0.5rem 0.444rem; }
.steps .next { flex-basis: 100%; min-height: 3.778rem; font-size: 1.222rem; }
.more { display: flex; justify-content: space-between; margin-top: 0.444rem; }
.more .ghost { color: var(--accent-text); min-height: 2.667rem; }
.own { margin-top: 0.444rem; }
.left { display: grid; gap: 0.444rem; }
.qs { margin-top: 0.667rem; }
.qs button { align-items: flex-start; gap: 0.556rem; }
.qs .cur { background: var(--accent-soft); }
.qs .no { flex: none; width: 1.556rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.qs .mark { flex: none; width: 1.111rem; text-align: center; color: var(--muted); font-weight: 700; }
.qs .mark.yes { color: var(--accent-text); }
@keyframes blink { 50% { opacity: .25; } }
</style>
