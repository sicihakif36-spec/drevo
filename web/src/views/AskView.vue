<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { store, canEdit, toast, onLive, loadTree } from '../store.js';
import { api } from '../api.js';
import { STATUS, shareAsk, when } from '../asks.js';
import { about } from '@shared/asks.js';
import { fullName } from '@shared/names.js';
import AnswerForm from '../components/AnswerForm.vue';
import AudioPlayer from '../components/AudioPlayer.vue';
import { ask } from '../components/ask.js';

// Один вопрос родным. Тому, кого спросили, — «Ответить»; владельцу и участникам — ответ и что с ним сделать:
// «Дописать в карточку», «Сохранить как историю», «Записать в журнал поиска», «Закрыть вопрос»; до ответа — «Напомнить», «Отозвать».
const props = defineProps({ id: String });
const router = useRouter();
const a = ref(null);
const error = ref('');
const busy = ref(false);
const link = ref(null);
const UNDO = 'Отменить можно в «Ещё → Последние правки».';

async function load() {
  try {
    a.value = await api('GET', `/api/asks/${props.id}`);
    error.value = '';
  } catch (e) {
    error.value = e.message;
  }
}
watch(() => props.id, () => { a.value = null; link.value = null; load(); }, { immediate: true });
onUnmounted(onLive((events) => { if (events.some((e) => ['asks', 'tree'].includes(e.kind))) return load(); }));

const p = computed(() => a.value && store.idx?.persons.get(a.value.person_id));
const mine = computed(() => a.value?.to_user === store.me?.id);
const answering = computed(() => mine.value && a.value.status === 'waiting');
const answered = computed(() => ['answered', 'closed'].includes(a.value?.status));
const voice = computed(() => a.value?.files.find((f) => f.kind === 'audio'));
const photos = computed(() => a.value?.files.filter((f) => f.kind === 'photo') || []);
const file = (f, full = false) => `/api/asks/${a.value.id}/files/${f.id}${full ? '?full' : ''}`;
const title = computed(() => (answering.value && p.value ? `Вас спрашивают ${about(p.value)}` : 'Вопрос родным'));

async function act(fn, done) {
  busy.value = true;
  try {
    const r = await fn();
    if (done) toast(typeof done === 'function' ? done(r) : done);
    await load();
    return r;
  } catch (e) {
    toast(e.message);
    return null;
  } finally {
    busy.value = false;
  }
}

async function sent() {
  toast('Ответ отправлен — спасибо!');
  await load();
  loadTree();
}
const story = () => act(() => api('POST', `/api/asks/${a.value.id}/story`), `Сохранено как история. ${UNDO}`);
const note = () => act(() => api('POST', `/api/asks/${a.value.id}/research`), `Записано в журнал поиска. ${UNDO}`);
const close = () => act(() => api('POST', `/api/asks/${a.value.id}/close`), 'Вопрос закрыт');
async function remind() {
  const r = await act(() => api('POST', `/api/asks/${a.value.id}/remind`), (x) => (x.url ? 'Новая ссылка готова: старая больше не работает' : 'Напомнили — придёт уведомление'));
  if (r?.url) link.value = { url: r.url, from: store.me.name, about: p.value ? about(p.value) : `о ${a.value.about}` };
}
async function revoke() {
  if (!await ask({ text: 'Отозвать вопрос?', note: a.value.link ? 'Ссылка перестанет работать.' : `${a.value.to_name} больше не увидит этот вопрос.`, yes: 'Отозвать', no: 'Не отзывать', danger: true })) return;
  act(() => api('POST', `/api/asks/${a.value.id}/revoke`), 'Вопрос отозван');
}
async function remove() {
  if (!await ask({ text: 'Удалить вопрос?', note: 'Он пропадёт из списка и из обсуждения. Что уже перенесено в дерево, останется.', yes: 'Удалить', no: 'Не удалять', danger: true })) return;
  if (await act(() => api('DELETE', `/api/asks/${a.value.id}`), 'Вопрос удалён')) router.replace('/asks');
}
// «Дописать в карточку»: правка карточки с ответом перед глазами, нужное поле — сразу.
const fill = () => router.push({ path: `/person/${a.value.person_id}`, query: { edit: '1', ask: a.value.id } });
</script>

<template>
  <div class="page">
    <div class="row" style="margin-bottom:0.444rem"><button class="ghost" @click="router.back()" aria-label="Назад">‹ Назад</button></div>
    <div v-if="error" class="card">{{ error }}</div>
    <div v-else-if="!a" class="muted">Загрузка…</div>
    <template v-else>
      <h1>{{ title }}</h1>
      <div class="card q">
        <div class="small muted">
          {{ a.from_name || 'Кто-то' }} → {{ a.to_name }}{{ a.link ? ' (по ссылке)' : '' }} · {{ when(a.created_at) }}
          <span v-if="!answering" class="status" :class="a.status">· {{ STATUS[a.status] }}</span>
        </div>
        <router-link v-if="p" :to="`/person/${p.id}`" class="about">{{ fullName(p) }}</router-link>
        <div v-else class="about">{{ a.about }}</div>
        <p class="question">{{ a.question }}</p>
        <div v-if="a.research_title" class="small muted">Из исследования: «{{ a.research_title }}»</div>
      </div>

      <AnswerForm v-if="answering" :base="`/api/asks/${a.id}`" :files="a.files" @sent="sent" />

      <template v-else-if="answered">
        <h2>Ответ{{ a.to_name ? `: ${a.to_name}` : '' }} <span class="muted small">· {{ when(a.answered_at) }}</span></h2>
        <div v-if="a.answer" class="card pre answer">{{ a.answer }}</div>
        <div v-if="voice" class="card voice"><AudioPlayer :src="file(voice, true)" :duration="voice.duration" /></div>
        <div v-if="photos.length" class="thumbs">
          <a v-for="f in photos" :key="f.id" :href="file(f, true)" target="_blank"><img :src="file(f)" alt="Фото из ответа" loading="lazy" /></a>
        </div>

        <template v-if="canEdit()">
          <h2>Перенести в дерево</h2>
          <div class="acts">
            <button class="primary" :disabled="busy" @click="fill">Дописать в карточку</button>
            <router-link v-if="a.story && a.story_id" class="btn" :to="{ path: `/person/${a.person_id}`, query: { story: a.story_id } }">Сохранено как история ›</router-link>
            <button v-else-if="!a.story" :disabled="busy" @click="story">Сохранить как историю</button>
            <template v-if="a.research_id">
              <div v-if="a.note" class="done small">Записано в журнал поиска</div>
              <button v-else :disabled="busy" @click="note">Записать в журнал поиска</button>
            </template>
            <button v-if="a.status === 'answered'" :disabled="busy" @click="close">Закрыть вопрос</button>
          </div>
          <p class="muted small">Правки по ответу — как обычные: видны в «Последних правках» и отменяются там.</p>
        </template>
      </template>

      <template v-else-if="mine">
        <p class="muted">{{ a.status === 'revoked' ? 'Этот вопрос отозвали — отвечать не нужно.' : '' }}</p>
      </template>

      <template v-if="canEdit() && ['waiting', 'expired'].includes(a.status)">
        <div class="card wait">
          <template v-if="a.link">
            <p class="small">{{ a.status === 'expired' ? 'Срок ссылки истёк.' : a.opened_at ? `Ссылку открыли ${when(a.opened_at)}, ответа пока нет.` : 'Ссылку пока не открывали.' }}
              Если её потеряли — сделайте новую: старая перестанет работать.</p>
          </template>
          <p v-else class="small">{{ a.to_name }} {{ { F: 'получила', M: 'получил' }[a.to_sex] || 'получил(а)' }} уведомление{{ a.reminded_at ? `, напомнили ${when(a.reminded_at)}` : '' }}. Ответа пока нет.</p>
          <div class="grid2">
            <button :disabled="busy" @click="remind">{{ a.link ? 'Новая ссылка' : 'Напомнить' }}</button>
            <button class="danger" :disabled="busy" @click="revoke">Отозвать</button>
          </div>
        </div>
        <div v-if="link" class="card" style="margin-top:0.667rem">
          <p class="small url">{{ link.url }}</p>
          <div class="grid2">
            <button class="primary" @click="shareAsk(link, 'share')">Поделиться</button>
            <button @click="shareAsk(link, 'copy')">Скопировать</button>
          </div>
        </div>
      </template>

      <button v-if="canEdit()" class="ghost danger block" style="margin-top:1rem" :disabled="busy" @click="remove">Удалить вопрос</button>
    </template>
  </div>
</template>

<style scoped>
.q { margin-bottom: 0.667rem; }
.about { display: inline-block; margin-top: 0.222rem; font-weight: 700; color: var(--accent-text); overflow-wrap: anywhere; }
.question { font-size: 1.167rem; font-weight: 700; margin: 0.333rem 0 0.222rem; white-space: pre-wrap; overflow-wrap: anywhere; }
.status { font-weight: 700; }
.status.answered { color: var(--accent-text); }
.status.waiting { color: var(--oral); }
.pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.answer { font-size: 1.056rem; line-height: 1.5; }
.voice { margin-top: 0.556rem; }
.thumbs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.444rem; margin-top: 0.556rem; }
.thumbs img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 0.556rem; background: var(--line); display: block; }
.acts { display: grid; gap: 0.5rem; }
.done { color: var(--accent-text); font-weight: 700; text-align: center; padding: 0.444rem; }
.wait { margin-top: 0.889rem; }
.wait p { margin: 0 0 0.556rem; }
.url { word-break: break-all; margin-top: 0; }
</style>
