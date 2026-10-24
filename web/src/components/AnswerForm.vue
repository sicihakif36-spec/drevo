<script setup>
import { onUnmounted, reactive, ref } from 'vue';
import { api, upload, shrinkImage } from '../api.js';
import { ASK_PHOTOS, ANSWER_MAX } from '@shared/asks.js';
import VoiceRecorder from './VoiceRecorder.vue';
import AudioPlayer from './AudioPlayer.vue';
import { ask } from './ask.js';

// Ответ на вопрос родным: текст крупно, по желанию — запись голоса и фото.
// И в приложении (base — /api/asks/<id>), и по ссылке без входа (base — /api/ask, headers — токен ссылки).
// Фото уходят на сервер сразу, запись голоса — вместе с ответом. files — уже приложенное раньше.
const props = defineProps({ base: String, headers: { type: Object, default: () => ({}) }, files: { type: Array, default: () => [] } });
const emit = defineEmits(['sent']);
const H = props.headers;
const text = ref('');
const voice = ref(null); // новая запись из VoiceRecorder
const urls = [];
const photos = ref(props.files.filter((f) => f.kind === 'photo').map((f) => reactive({ ...f, url: '' })));
const savedVoice = ref(props.files.find((f) => f.kind === 'audio') || null);
const progress = ref('');
const error = ref('');
const sending = ref(false);

// Миниатюры уже приложенных фото: по ссылке — с токеном в заголовке, поэтому через fetch.
for (const p of photos.value) {
  fetch(`${props.base}/files/${p.id}`, { headers: H }).then((r) => (r.ok ? r.blob() : null)).then((b) => {
    if (b) urls.push((p.url = URL.createObjectURL(b)));
  }).catch(() => {});
}
onUnmounted(() => urls.forEach((u) => URL.revokeObjectURL(u)));

async function addPhotos(e) {
  const list = [...e.target.files].slice(0, ASK_PHOTOS - photos.value.length);
  e.target.value = '';
  error.value = '';
  for (const [i, file] of list.entries()) {
    progress.value = list.length > 1 ? `Отправляю фото ${i + 1} из ${list.length}…` : 'Отправляю фото…';
    try {
      const img = await shrinkImage(file, [[1600, 0.86], [400, 0.8]]);
      const fd = new FormData();
      fd.append('file', img ? new File([img[0]], 'foto.jpg', { type: 'image/jpeg' }) : file);
      if (img) fd.append('thumb', new File([img[1]], 'thumb.jpg', { type: 'image/jpeg' }));
      const p = reactive({ ...(await upload(`${props.base}/files`, fd, null, H)), url: '' });
      if (img) urls.push((p.url = URL.createObjectURL(img[1])));
      photos.value.push(p);
    } catch (err) {
      error.value = err.message;
      break;
    }
  }
  progress.value = '';
}

async function drop(f) {
  if (!await ask({ text: f.kind === 'audio' ? 'Убрать запись голоса?' : 'Убрать это фото?', yes: 'Убрать', no: 'Не убирать', danger: true })) return;
  try {
    await api('DELETE', `${props.base}/files/${f.id}`, undefined, H);
    if (f.kind === 'audio') savedVoice.value = null;
    else photos.value = photos.value.filter((x) => x !== f);
  } catch (e) { error.value = e.message; }
}

const empty = () => !text.value.trim() && !voice.value && !savedVoice.value && !photos.value.length;

async function send() {
  if (empty()) {
    error.value = 'Напишите ответ, запишите голос или приложите фото.';
    return;
  }
  if (!await ask({ text: 'Отправить ответ?', note: 'После этого изменить его будет нельзя.', yes: 'Отправить', no: 'Ещё не отправлять' })) return;
  sending.value = true;
  error.value = '';
  try {
    if (voice.value) {
      const fd = new FormData();
      fd.append('file', voice.value.blob, voice.value.name);
      savedVoice.value = await upload(`${props.base}/files`, fd, (x) => {
        progress.value = x < 1 ? `Отправляю запись… ${Math.round(x * 100)}%` : 'Готовлю запись…';
      }, H);
      voice.value = null;
    }
    progress.value = '';
    await api('POST', `${props.base}/answer`, { answer: text.value }, H);
    emit('sent', text.value.trim());
  } catch (e) {
    error.value = e.message;
  } finally {
    sending.value = false;
    progress.value = '';
  }
}
</script>

<template>
  <div class="answer">
    <label class="field"><span>Ваш ответ</span>
      <textarea v-model="text" class="big" :maxlength="ANSWER_MAX" placeholder="Напишите, что знаете или помните. Можно коротко." />
    </label>

    <h3>Можно ответить голосом</h3>
    <div v-if="savedVoice" class="card saved">
      <span class="grow">Запись голоса приложена</span>
      <button type="button" class="ghost danger" @click="drop(savedVoice)">Убрать</button>
    </div>
    <VoiceRecorder v-else @change="voice = $event" />

    <h3>И приложить фото</h3>
    <div v-if="photos.length" class="thumbs">
      <div v-for="p in photos" :key="p.id" class="thumb">
        <img v-if="p.url" :src="p.url" alt="" />
        <div v-else class="noimg muted small">фото</div>
        <button type="button" class="ghost danger small" @click="drop(p)">Убрать</button>
      </div>
    </div>
    <label v-if="photos.length < ASK_PHOTOS && !progress" class="btn block add">
      + Добавить фото
      <input type="file" accept="image/*" multiple hidden @change="addPhotos" />
    </label>
    <p class="muted small">Можно до {{ ASK_PHOTOS }} фото.</p>

    <p v-if="progress" class="muted">{{ progress }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <button class="primary block huge" :disabled="sending || Boolean(progress)" @click="send">{{ sending ? 'Отправляю…' : 'Ответить' }}</button>
  </div>
</template>

<style scoped>
.answer h3 { font-size: 1rem; margin: 1rem 0 0.444rem; }
.big { min-height: 10rem; font-size: 1.111rem; line-height: 1.45; }
.saved { display: flex; align-items: center; gap: 0.5rem; padding-top: 0.333rem; padding-bottom: 0.333rem; }
.thumbs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.444rem; margin-bottom: 0.556rem; }
.thumb { display: grid; gap: 0.111rem; }
.thumb img, .noimg { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 0.556rem; background: var(--line); display: grid; place-items: center; }
.thumb .ghost { min-height: 2.444rem; padding: 0; }
.add { margin-top: 0.222rem; min-height: 3rem; border: 2px dashed var(--field); background: var(--card); }
.huge { min-height: 3.333rem; font-size: 1.111rem; margin-top: 0.667rem; }
</style>
