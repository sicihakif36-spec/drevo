<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { api, upload, shrinkImage } from '../api.js';
import { STEPS, ROLES, MAX_PHOTOS, newId, filled, surveyPeople } from '@shared/survey.js';
import SurveyPerson from '../components/SurveyPerson.vue';
import { vGrow } from '../grow.js';
import { ask } from '../components/ask.js';
import { nameAccusative } from '@shared/names.js';

// Анкета по ссылке: без входа, ничего из дерева — только пустые поля и имя того, кто просит.
// Ответы сохраняются на сервере по ходу: можно закрыть и вернуться по той же ссылке.
const props = defineProps({ token: String });
const H = { 'x-survey': props.token };
const sapi = (method, url, body) => api(method, url, body, H);

const state = ref('loading'); // loading | error | fill | sent
const error = ref('');
const from = ref('');
const answers = ref(null);
const photos = ref([]);
const step = ref(0); // 0 — вступление, 1…STEPS.length — шаги, дальше — «Отправить»
const saving = reactive({ busy: false, failed: false, at: null });
const FINISH = STEPS.length + 1;

onMounted(async () => {
  document.title = 'Анкета о семье';
  try {
    const s = await sapi('GET', '/api/survey');
    // Пустые места для людей, которых может быть несколько.
    for (const role of ['spouse', 'child', 'sibling']) if (!s.answers.people[role].length) s.answers.people[role].push(blank(role));
    from.value = s.from;
    answers.value = s.answers;
    photos.value = s.photos.map((p) => ({ ...p, url: '' }));
    step.value = s.submitted ? 0 : Math.min(s.answers.step || 0, FINISH);
    state.value = s.submitted ? 'sent' : 'fill';
    photos.value.forEach(loadThumb);
  } catch (e) {
    error.value = e.message;
    state.value = 'error';
  }
});

const blank = (role) => ({ id: newId(), given: '', patronymic: '', surname: '', birth_surname: '', sex: ROLES[role].sex || 'U', living: null,
  birth_date: '', birth_place: '', death_date: '', death_place: '', occupation: '', notes: '', ...(role === 'child' ? { parent2: '' } : {}) });

// Сохранение: через секунду после последней правки и сразу при переходе между шагами.
let timer = null;
let dirty = false;
async function save() {
  clearTimeout(timer);
  if (!dirty || state.value !== 'fill') return;
  dirty = false;
  saving.busy = true;
  try {
    await sapi('PUT', '/api/survey', { answers: { ...answers.value, step: step.value } });
    saving.failed = false;
    saving.at = new Date();
  } catch (e) {
    dirty = true;
    saving.failed = true;
    if (e.status === 0) timer = setTimeout(save, 10000);
    else error.value = e.message;
  } finally {
    saving.busy = false;
  }
}
watch(answers, (v, old) => {
  if (!old) return; // только что открыли — сохранять нечего
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(save, 1000);
}, { deep: true });
const onHide = () => { if (document.hidden) save(); };
document.addEventListener('visibilitychange', onHide);
onBeforeUnmount(() => { document.removeEventListener('visibilitychange', onHide); save(); });

function go(n) {
  dirty = true;
  step.value = n;
  save();
  window.scrollTo(0, 0);
}

const cur = computed(() => STEPS[step.value - 1]);
const people = computed(() => (answers.value ? surveyPeople(answers.value) : []));
const savedText = computed(() => {
  if (saving.failed) return 'Не сохранилось: нет связи. Попробую ещё раз.';
  if (saving.busy) return 'Сохраняю…';
  return saving.at ? 'Сохранено' : '';
});

async function remove(role, i) {
  const list = answers.value.people[role];
  if (filled(list[i]) && !await ask({ text: `Убрать ${list[i].given ? nameAccusative(list[i], true) : 'этого человека'} из анкеты?`, note: 'Всё, что о нём написано, пропадёт.', yes: 'Убрать', no: 'Не убирать', danger: true })) return;
  list.splice(i, 1);
}

// ---------- Фото ----------
const progress = ref('');
const photoError = ref('');
async function loadThumb(p) {
  try {
    const res = await fetch(`/api/survey/photos/${p.id}`, { headers: H });
    if (res.ok) p.url = URL.createObjectURL(await res.blob());
  } catch { /* покажем без миниатюры */ }
}
async function addPhotos(e) {
  const files = [...e.target.files].slice(0, MAX_PHOTOS - photos.value.length);
  e.target.value = '';
  photoError.value = '';
  for (const [i, file] of files.entries()) {
    progress.value = files.length > 1 ? `Отправляю фото ${i + 1} из ${files.length}…` : 'Отправляю фото…';
    try {
      const img = await shrinkImage(file, [[1600, 0.86], [400, 0.8]]);
      const fd = new FormData();
      fd.append('caption', '');
      fd.append('file', img ? new File([img[0]], 'foto.jpg', { type: 'image/jpeg' }) : file);
      if (img) fd.append('thumb', new File([img[1]], 'thumb.jpg', { type: 'image/jpeg' }));
      const p = reactive({ ...(await upload('/api/survey/photos', fd, null, H)), url: '' });
      p.url = img ? URL.createObjectURL(img[1]) : '';
      photos.value.push(p);
    } catch (err) {
      photoError.value = err.message;
      break;
    }
  }
  progress.value = '';
}
async function caption(p) {
  try { await sapi('PATCH', `/api/survey/photos/${p.id}`, { caption: p.caption }); } catch (e) { photoError.value = e.message; }
}
async function dropPhoto(p) {
  if (!await ask({ text: 'Убрать это фото из анкеты?', yes: 'Убрать', no: 'Не убирать', danger: true })) return;
  try {
    await sapi('DELETE', `/api/survey/photos/${p.id}`);
    photos.value = photos.value.filter((x) => x !== p);
  } catch (e) { photoError.value = e.message; }
}

// ---------- Отправка ----------
const sending = ref(false);
async function submit() {
  if (!await ask({ text: 'Отправить анкету?', note: 'После этого менять ответы будет нельзя.', yes: 'Отправить', no: 'Ещё не отправлять' })) return;
  sending.value = true;
  error.value = '';
  try {
    clearTimeout(timer);
    await sapi('POST', '/api/survey/submit', { answers: { ...answers.value, step: step.value } });
    state.value = 'sent';
    window.scrollTo(0, 0);
  } catch (e) {
    error.value = e.message;
  } finally {
    sending.value = false;
  }
}
const label = (x) => (x.role === 'self' ? 'Вы' : ROLES[x.role].label);
const nameOf = (p) => [p.surname, p.given, p.patronymic].map((s) => s.trim()).filter(Boolean).join(' ');
</script>

<template>
  <div class="page survey">
    <div v-if="state === 'loading'" class="muted">Загрузка…</div>

    <template v-else-if="state === 'error'">
      <h1>Анкета о семье</h1>
      <div class="card big-text">{{ error }}</div>
    </template>

    <template v-else-if="state === 'sent'">
      <h1>Спасибо!</h1>
      <div class="card big-text">
        <p>Анкета отправлена<template v-if="from">: {{ from }} увидит ваши ответы и добавит их в семейное дерево</template>.</p>
        <p class="muted">Менять ответы больше нельзя. Если что-то вспомните — расскажите {{ from || 'тому, кто прислал ссылку' }}.</p>
      </div>
      <h2>Вы рассказали о</h2>
      <div class="list">
        <div v-for="x in people" :key="x.person.id"><span class="muted who">{{ label(x) }}</span><span class="grow">{{ nameOf(x.person) }}</span></div>
      </div>
    </template>

    <template v-else>
      <!-- Вступление -->
      <template v-if="step === 0">
        <h1>Анкета о семье</h1>
        <div class="card big-text">
          <p><b>{{ from || 'Ваш родственник' }}</b> просит вас рассказать о семье.</p>
          <p>Здесь несколько коротких шагов: о вас, о супруге, детях, родителях, бабушках и дедушках, братьях и сёстрах. Пишите, что помните, — необязательно всё. Пустые поля можно пропускать.</p>
          <p>Ответы сохраняются сами. Можно закрыть страницу и вернуться позже по той же ссылке.</p>
        </div>
        <button class="primary block huge" @click="go(1)">Начать</button>
      </template>

      <!-- Шаги -->
      <template v-else-if="cur">
        <div class="muted small">Шаг {{ step }} из {{ STEPS.length }}</div>
        <div class="bar"><i :style="{ width: `${(step / STEPS.length) * 100}%` }" /></div>
        <h1>{{ cur.title }}</h1>
        <p v-if="cur.hint" class="hint">{{ cur.hint }}</p>

        <template v-for="role in cur.roles || []" :key="role">
          <template v-if="ROLES[role].many">
            <SurveyPerson v-for="(p, i) in answers.people[role]" :key="p.id" :person="p" :role="role" :answers="answers" removable
              @remove="remove(role, i)" />
            <button v-if="answers.people[role].length < ROLES[role].many" class="block add" @click="answers.people[role].push(blank(role))">
              + {{ ROLES[role].add }}
            </button>
          </template>
          <SurveyPerson v-else :person="answers.people[role]" :role="role" :answers="answers" />
        </template>

        <label v-if="cur.story" class="field">
          <textarea v-model="answers.story" class="story" maxlength="20000" placeholder="Например: родители познакомились в 1952 году в Калинине…" />
        </label>

        <template v-if="cur.photos">
          <div v-for="p in photos" :key="p.id" class="card photo">
            <img v-if="p.url" :src="p.url" alt="" />
            <div v-else class="noimg muted">фото</div>
            <label class="field"><span>Кто на фото, когда, где</span>
              <textarea v-model="p.caption" v-grow class="line" rows="1" maxlength="500" @blur="caption(p)" />
            </label>
            <button class="ghost danger" @click="dropPhoto(p)">Убрать фото</button>
          </div>
          <p v-if="progress" class="muted">{{ progress }}</p>
          <p v-if="photoError" class="error">{{ photoError }}</p>
          <label v-if="photos.length < MAX_PHOTOS && !progress" class="btn block add">
            + Добавить фото
            <input type="file" accept="image/*" multiple hidden @change="addPhotos" />
          </label>
          <p class="muted small">Можно до {{ MAX_PHOTOS }} фото.</p>
        </template>

        <div class="nav-steps">
          <button class="huge" @click="go(step - 1)">Назад</button>
          <button class="primary huge" @click="go(step + 1)">Дальше</button>
        </div>
        <!-- Главная кнопка всегда «Дальше»; пропустить пустой шаг — второстепенной. -->
        <button v-if="cur.roles && !cur.roles.some((r) => answers.people[r] && (ROLES[r].many ? answers.people[r].some(filled) : filled(answers.people[r])))"
          class="ghost block skip" @click="go(step + 1)">Пропустить этот шаг</button>
      </template>

      <!-- Отправка -->
      <template v-else>
        <h1>Почти готово</h1>
        <div class="card big-text">
          <p v-if="people.length">Вы рассказали о {{ people.length }} {{ people.length === 1 ? 'человеке' : 'людях' }}{{ answers.story.trim() ? ', написали воспоминания' : '' }}{{ photos.length ? `, приложили ${photos.length} фото` : '' }}.</p>
          <p v-else>Вы пока не указали ни одного имени. Вернитесь и заполните хотя бы своё.</p>
          <p class="muted">Проверьте, если хотите, и нажмите «Отправить». После отправки менять ответы будет нельзя.</p>
        </div>
        <div class="list" v-if="people.length" style="margin-top:12px">
          <a v-for="x in people" :key="x.person.id" href="#" @click.prevent="go(STEPS.findIndex((s) => (s.roles || []).includes(x.role)) + 1)">
            <span class="muted who">{{ label(x) }}</span><span class="grow">{{ nameOf(x.person) }}</span><span class="muted">›</span>
          </a>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <button class="primary block huge" style="margin-top:16px" :disabled="sending || !people.length" @click="submit">{{ sending ? 'Отправляю…' : 'Отправить' }}</button>
        <button class="block huge" style="margin-top:8px" @click="go(STEPS.length)">Назад</button>
      </template>

      <div class="saved small" :class="{ bad: saving.failed }" aria-live="polite">{{ savedText }}</div>
    </template>
  </div>
</template>

<style scoped>
.survey { padding-bottom: calc(6rem + var(--safe-b)); }
.survey h1 { margin-top: 0.333rem; overflow-wrap: anywhere; }
.big-text { line-height: 1.5; }
.big-text p { margin: 0 0 10px; }
.big-text p:last-child { margin-bottom: 0; }
.hint { margin: -4px 0 8px; color: var(--muted); }
.huge { min-height: 3.111rem; font-size: 1.056rem; }
.add { width: 100%; margin-top: 0.667rem; min-height: 3rem; border: 2px dashed var(--field); background: var(--card); }
.nav-steps { display: grid; grid-template-columns: 1fr 2fr; gap: 0.556rem; margin-top: 1.111rem; }
.skip { margin-top: 0.444rem; color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; }
.bar { height: 6px; background: var(--line); border-radius: 3px; margin: 6px 0 12px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--accent); }
.story { min-height: 14rem; }
.photo { margin-top: 12px; }
.photo img { width: 100%; max-height: 320px; object-fit: contain; border-radius: 10px; background: var(--line); }
.noimg { height: 120px; display: grid; place-items: center; background: var(--line); border-radius: 10px; }
.who { width: 6.667rem; flex: none; font-size: 0.889rem; }
.saved { position: fixed; left: 0; right: 0; bottom: 0; padding: 8px 16px calc(8px + var(--safe-b)); text-align: center; background: var(--bg); color: var(--muted); }
.saved:empty { display: none; }
.saved.bad { color: var(--danger); }
</style>
