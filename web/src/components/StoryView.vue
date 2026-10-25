<script setup>
import { computed, reactive, ref } from 'vue';
import { store, canEdit, toast } from '../store.js';
import { api, upload, photoUrl } from '../api.js';
import { fullName, lifespan, namePrepositional, nameGenitive, personHas } from '@shared/names.js';
import { ivTitle } from '@shared/interview.js';
import { ask } from './ask.js';
import AudioPlayer from './AudioPlayer.vue';
import VoiceRecorder from './VoiceRecorder.vue';

// Открытая история поверх карточки: чтение, правка, «О ком» и удаление. story — null для новой истории.
// chain — истории того же интервью по порядку: «Предыдущий ответ», «Следующий ответ».
const props = defineProps({ story: Object, person: Object, chain: { type: Array, default: () => [] } });
const emit = defineEmits(['close', 'saved', 'removed', 'go']);
const place = computed(() => props.chain.indexOf(props.story?.id));

const mode = ref(props.story ? 'view' : 'edit'); // view, edit, link
const form = reactive({ title: props.story?.title || '', date: props.story?.date || '', body: props.story?.body || '' });
const voice = ref(null); // новая запись из VoiceRecorder
const dropAudio = ref(false); // убрать прежнюю запись
const saving = ref('');
const error = ref('');
const query = ref('');

const s = computed(() => props.story);
const people = computed(() => (s.value?.persons || []).map((id) => store.idx?.persons.get(id)).filter(Boolean));
const when = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

// Поиск по дереву для «Связать с людьми»: по каждому слову фамилии, имени, отчества.
const found = computed(() => {
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || !store.idx) return [];
  const linked = new Set(s.value?.persons || []);
  return [...store.idx.persons.values()]
    .filter((p) => !linked.has(p.id) && personHas(p, query.value))
    .slice(0, 20);
});

function edit() {
  Object.assign(form, { title: s.value.title, date: s.value.date, body: s.value.body });
  voice.value = null;
  dropAudio.value = false;
  error.value = '';
  mode.value = 'edit';
}

function cancel() {
  if (!s.value) emit('close');
  else mode.value = 'view';
}

async function save() {
  error.value = '';
  if (!voice.value && !form.body.trim() && !form.title.trim() && !s.value?.audio_id) {
    error.value = 'Запишите голос или напишите рассказ.';
    return;
  }
  // Без заголовка — «Рассказ о Петре, 21 октября».
  const title = form.title.trim() || `Рассказ о ${namePrepositional(props.person, true)}, ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
  const data = { title, date: form.date, body: form.body };
  try {
    if (voice.value) {
      saving.value = 'Отправляю запись…';
      const fd = new FormData();
      fd.append('file', voice.value.blob, voice.value.name);
      // Когда запись дошла, сервер ещё переводит её в MP3.
      const a = await upload('/api/audio', fd, (x) => { saving.value = x < 1 ? `Отправляю запись… ${Math.round(x * 100)}%` : 'Готовлю запись…'; });
      data.audio_id = a.id;
    } else if (dropAudio.value) data.audio_id = null;
    saving.value = 'Сохраняю…';
    const saved = s.value
      ? await api('PATCH', `/api/stories/${s.value.id}`, data)
      : await api('POST', `/api/persons/${props.person.id}/stories`, data);
    voice.value = null;
    // Новая история откроется заново уже сохранённой (Stories.vue).
    if (s.value) mode.value = 'view';
    emit('saved', saved);
    toast('История сохранена');
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = '';
  }
}

async function link(p) {
  try {
    emit('saved', await api('PUT', `/api/stories/${s.value.id}/persons/${p.id}`));
    query.value = '';
    toast(`Связано: ${fullName(p)}`);
  } catch (e) { toast(e.message); }
}

async function unlink(p) {
  if (!await ask({ text: `Убрать историю из карточки ${nameGenitive(p, true)}?`, note: `${fullName(p)}. У остальных история останется.`, yes: 'Убрать', no: 'Не убирать', danger: true })) return;
  try {
    const saved = await api('DELETE', `/api/stories/${s.value.id}/persons/${p.id}`);
    emit('saved', saved);
  } catch (e) { toast(e.message); }
}

async function remove() {
  if (!await ask({ text: `Удалить историю «${s.value.title}»?`, note: 'Она пропадёт у всех, о ком рассказана. Вернуть можно в «Главная → Последние правки».', yes: 'Удалить', no: 'Не удалять', danger: true })) return;
  try {
    await api('DELETE', `/api/stories/${s.value.id}`);
    toast('История удалена. Вернуть можно в «Главная → Последние правки».');
    emit('removed');
  } catch (e) { toast(e.message); }
}
</script>

<template>
  <div class="story" role="dialog" aria-modal="true">
    <div class="page">
      <div class="row top">
        <button class="ghost" @click="mode === 'view' ? emit('close') : cancel()">‹ {{ mode === 'view' ? 'Назад' : 'Отмена' }}</button>
      </div>

      <form v-if="mode === 'edit'" @submit.prevent="save">
        <h1>{{ s ? 'Изменить историю' : 'Новая история' }}</h1>
        <p v-if="!s" class="muted">О ком: {{ fullName(person) }}. Других людей можно добавить после сохранения.</p>
        <!-- Сначала голос: рассказать проще, чем написать. -->
        <div class="card">
          <template v-if="s?.audio_id && !dropAudio && !voice">
            <AudioPlayer :src="photoUrl(s.audio_id)" :duration="s.audio_duration" />
            <p class="muted small">Новая запись заменит эту.</p>
          </template>
          <VoiceRecorder @change="voice = $event" />
          <button v-if="s?.audio_id && !dropAudio && !voice" type="button" class="danger block" @click="dropAudio = true">Убрать прежнюю запись</button>
          <p v-if="dropAudio && !voice" class="muted small">Прежняя запись будет убрана. <a href="#" @click.prevent="dropAudio = false">Оставить</a></p>
        </div>

        <h2 class="or">или написать текстом</h2>
        <label class="field"><span>Рассказ</span><textarea v-model="form.body" maxlength="20000" rows="6" placeholder="Что помните: кто, где, когда, что было" /></label>
        <label class="field"><span>Заголовок</span><input v-model="form.title" maxlength="200" :placeholder="`Можно не писать: «Рассказ о ${namePrepositional(person, true)}»`" /></label>
        <label class="field"><span>Когда это было</span><input v-model="form.date" maxlength="100" placeholder="например: около 1945, лето 1960" /></label>

        <p class="error" v-if="error">{{ error }}</p>
        <div class="row actions">
          <button type="button" class="grow" @click="cancel">Отмена</button>
          <button class="primary grow" :disabled="Boolean(saving)">{{ saving || 'Сохранить' }}</button>
        </div>
      </form>

      <template v-else>
        <div v-if="s.interview_id" class="ivhead small">{{ ivTitle(s.interview_at) }} · ответ {{ s.interview_no }}{{ chain.length ? ` из ${chain.length}` : '' }}</div>
        <h1>{{ s.title }}</h1>
        <div class="muted">{{ [s.date, `записано ${when(s.created_at)}`, s.user_name].filter(Boolean).join(' · ') }}</div>
        <div v-if="s.audio_id" class="card voice"><AudioPlayer :src="photoUrl(s.audio_id)" :duration="s.audio_duration" /></div>
        <div v-if="s.body" class="body">{{ s.body }}</div>
        <div v-if="chain.length > 1 && place >= 0" class="row chain">
          <button class="grow" :disabled="place === 0" @click="emit('go', chain[place - 1])">‹ Предыдущий</button>
          <button class="primary grow" :disabled="place === chain.length - 1" @click="emit('go', chain[place + 1])">Следующий ответ ›</button>
        </div>

        <h2>О ком</h2>
        <div class="list">
          <div v-for="x in people" :key="x.id">
            <router-link :to="`/person/${x.id}`" class="who grow">
              <div class="avatar" :class="x.sex">{{ (x.given || '?')[0] }}</div>
              <div class="grow"><div class="ellipsis">{{ fullName(x) }}</div><div class="muted small">{{ lifespan(x) }}</div></div>
            </router-link>
            <button v-if="mode === 'link' && people.length > 1" class="danger" :aria-label="`Убрать: ${fullName(x)}`" @click="unlink(x)">Убрать</button>
          </div>
        </div>

        <template v-if="mode === 'link'">
          <h2>Связать с людьми</h2>
          <input v-model="query" type="search" placeholder="Начните писать фамилию или имя" autofocus />
          <div v-if="found.length" class="list found">
            <button v-for="x in found" :key="x.id" class="pick" @click="link(x)">
              <div class="avatar" :class="x.sex">{{ (x.given || '?')[0] }}</div>
              <div class="grow"><div class="ellipsis">{{ fullName(x) }}</div><div class="muted small">{{ lifespan(x) }}</div></div>
              <span class="plus">+</span>
            </button>
          </div>
          <p v-else-if="query.trim()" class="muted">Никого не нашлось. Попробуйте только фамилию</p>
          <button class="primary block done" @click="mode = 'view'">Готово</button>
        </template>

        <div v-else-if="canEdit()" class="actions-col">
          <button class="block" @click="edit">Изменить</button>
          <button class="block" @click="mode = 'link'">Связать с людьми</button>
          <button class="danger block" @click="remove">Удалить историю</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.story { position: fixed; inset: 0; z-index: 50; background: var(--bg); overflow-y: auto; overscroll-behavior: contain; }
.story .page { padding-bottom: calc(1.778rem + var(--safe-b)); }
.top { margin-bottom: 0.444rem; }
h1 { overflow-wrap: anywhere; }
.or { text-align: center; color: var(--muted); font-weight: 400; margin: 1.111rem 0 0.25rem; }
.voice { margin-top: 0.778rem; }
.ivhead { font-weight: 700; color: var(--accent-text); margin-bottom: 0.222rem; }
.chain { margin-top: 1rem; }
.body { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.55; margin-top: 0.889rem; }
.who { display: flex; align-items: center; gap: 0.667rem; color: inherit; text-decoration: none; }
.found { margin-top: 0.444rem; }
.plus { font-size: 1.444rem; color: var(--accent-text); }
.card { display: flex; flex-direction: column; gap: 0.556rem; }
.actions { margin-top: 0.889rem; }
.actions-col { display: flex; flex-direction: column; gap: 0.444rem; margin-top: 1.222rem; }
.done { margin-top: 0.667rem; }
</style>
