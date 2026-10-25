<script setup>
import { computed, ref, watch } from 'vue';
import { store, toast } from '../store.js';
import { api } from '../api.js';
import { askSheet, shareAsk } from '../asks.js';
import { askHints, about, ASK_MAX } from '@shared/asks.js';
import { fullName } from '@shared/names.js';
import { vGrow } from '../grow.js';

// Окно «Спросить у родных»: о ком, вопрос (готовые подсказки или свой) и кому —
// тому, кто пользуется приложением (придёт уведомление), или ссылкой тому, кто не пользуется.
const p = computed(() => store.idx?.persons.get(askSheet.person));
const hints = computed(() => (p.value ? askHints(p.value, store.idx) : []));
const question = ref(askSheet.text);
const field = ref(askSheet.field);
const people = ref(null);
const to = ref(null); // id пользователя или 'link'
const toName = ref('');
const busy = ref(false);
const error = ref('');
const link = ref(null);

api('GET', '/api/asks/people').then((x) => { people.value = x; }, (e) => { error.value = e.message; people.value = []; });

function pick(h) {
  question.value = h.text;
  field.value = h.field;
}
// Свой текст — и подсказанное поле больше не подходит, если вопрос переписали целиком.
watch(question, (v) => { if (!v.trim()) field.value = ''; });

// Кто это в дереве — чтобы не перепутать двух Ольг.
const inTree = (u) => (u.person_id && store.idx?.persons.get(u.person_id) ? fullName(store.idx.persons.get(u.person_id)) : '');
const ready = computed(() => question.value.trim() && (to.value === 'link' ? toName.value.trim() : to.value));

async function send() {
  busy.value = true;
  error.value = '';
  try {
    const body = { person_id: p.value.id, question: question.value, field: field.value, research_id: askSheet.research_id };
    if (to.value === 'link') {
      const a = await api('POST', '/api/asks', { ...body, to_name: toName.value });
      link.value = { url: a.url, from: store.me.name, about: about(p.value), name: toName.value };
    } else {
      const a = await api('POST', '/api/asks', { ...body, to_user: to.value });
      toast(`Вопрос отправлен: ${a.to_name} получит уведомление`);
      close();
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
const close = () => { askSheet.open = false; };
</script>

<template>
  <div class="sheet-backdrop" @click="close" />
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ask-title">
    <template v-if="link">
      <h2 id="ask-title" class="top">Ссылка для: {{ link.name }}</h2>
      <p class="small">Отправьте её в любом мессенджере. По ссылке откроется только ваш вопрос — без входа и без дерева.
        Работает 30 дней. Ответ придёт вам уведомлением и в «Ещё → Вопросы родным».</p>
      <p class="small url">{{ link.url }}</p>
      <div class="grid2">
        <button class="primary" @click="shareAsk(link, 'share')">Поделиться</button>
        <button @click="shareAsk(link, 'copy')">Скопировать</button>
      </div>
      <button class="ghost block done" @click="close">Готово</button>
    </template>

    <template v-else-if="p">
      <h2 id="ask-title" class="top">Спросить у родных</h2>
      <p class="muted small who">О ком: <b>{{ fullName(p) }}</b></p>

      <label class="field"><span>Вопрос</span>
        <textarea v-model="question" v-grow rows="2" :maxlength="ASK_MAX" placeholder="Например: где родилась бабушка?" />
      </label>
      <p class="muted small pick">Или выберите готовый:</p>
      <div class="hints" role="group" aria-label="Готовые вопросы">
        <button v-for="h in hints" :key="h.text" type="button" class="chip" :class="{ on: question === h.text }" @click="pick(h)">{{ h.text }}</button>
      </div>

      <div class="field">
        <span>Кого спросить</span>
        <div v-if="!people" class="muted small">Загрузка…</div>
        <div v-else class="list to">
          <button v-for="u in people" :key="u.id" type="button" :class="{ on: to === u.id }" :aria-pressed="to === u.id" @click="to = u.id">
            <span class="mark" aria-hidden="true" />
            <span class="grow">{{ u.name }}<span v-if="inTree(u)" class="muted small"><br />{{ inTree(u) }}</span></span>
          </button>
          <button type="button" :class="{ on: to === 'link' }" :aria-pressed="to === 'link'" @click="to = 'link'">
            <span class="mark" aria-hidden="true" />
            <span class="grow">Того, кто приложением не пользуется<br /><span class="muted small">отправите ему ссылку</span></span>
          </button>
        </div>
        <p v-if="people && !people.length" class="muted small">Пока никто, кроме вас, не вошёл в приложение — отправьте ссылку.</p>
      </div>
      <label v-if="to === 'link'" class="field"><span>Кого спрашиваете (видите только вы и участники, например «Тётя Валя»)</span>
        <input v-model="toName" maxlength="80" />
      </label>

      <p v-if="error" class="error">{{ error }}</p>
      <div class="row">
        <button type="button" class="grow" @click="close">Отмена</button>
        <button class="primary grow" :disabled="busy || !ready" @click="send">{{ busy ? 'Отправляю…' : to === 'link' ? 'Сделать ссылку' : 'Спросить' }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.top { margin-top: 0; }
.who { margin: -0.333rem 0 0; overflow-wrap: anywhere; }
.pick { margin: -0.333rem 0 0.333rem; }
.hints { display: flex; flex-wrap: wrap; gap: 0.444rem; }
.hints .chip { text-align: left; justify-content: flex-start; white-space: normal; }
.to > button { gap: 0.667rem; }
.to > button.on { background: var(--accent-soft); color: var(--accent-soft-text); font-weight: 700; }
.to > button.on .muted { color: var(--accent-soft-text); }
.mark { flex: none; width: 1.333rem; height: 1.333rem; border-radius: 50%; border: 2px solid var(--field); }
.on .mark { border: 0.389rem solid var(--accent); }
.url { word-break: break-all; }
.done { margin-top: 0.444rem; }
</style>
