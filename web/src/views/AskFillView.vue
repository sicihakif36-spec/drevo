<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api.js';
import AnswerForm from '../components/AnswerForm.vue';

// Вопрос родным по ссылке: без входа и без дерева — только кто спрашивает, о ком и сам вопрос.
const props = defineProps({ token: String });
const H = { 'x-ask': props.token };
const state = ref('loading'); // loading | error | fill | sent
const error = ref('');
const a = ref(null);
const answer = ref('');

onMounted(async () => {
  document.title = 'Вопрос о семье';
  try {
    a.value = await api('GET', '/api/ask', undefined, H);
    answer.value = a.value.answer;
    state.value = a.value.answered ? 'sent' : 'fill';
  } catch (e) {
    error.value = e.message;
    state.value = 'error';
  }
});
function sent(text) {
  answer.value = text;
  state.value = 'sent';
  window.scrollTo(0, 0);
}
</script>

<template>
  <div class="page fill">
    <div v-if="state === 'loading'" class="muted">Загрузка…</div>

    <template v-else-if="state === 'error'">
      <h1>Вопрос о семье</h1>
      <div class="card big-text">{{ error }}</div>
    </template>

    <template v-else-if="state === 'sent'">
      <h1>Ответ отправлен — спасибо!</h1>
      <div class="card big-text">
        <p>{{ a.from || 'Ваш родственник' }} увидит ваш ответ и добавит его в семейное дерево.</p>
        <p class="muted">Если вспомните ещё что-нибудь — просто напишите в ответ на сообщение со ссылкой.</p>
      </div>
      <template v-if="answer">
        <h2>Ваш ответ</h2>
        <div class="card pre">{{ answer }}</div>
      </template>
    </template>

    <template v-else>
      <h1>{{ a.from || 'Ваш родственник' }} спрашивает вас</h1>
      <div class="card big-text q">
        <div class="muted small">О ком: {{ a.about }}</div>
        <p class="question">{{ a.question }}</p>
      </div>
      <AnswerForm base="/api/ask" :headers="H" :files="a.files" @sent="sent" />
      <p class="muted small foot">Эта страничка — только для ответа. Семейное дерево по ней не открывается.</p>
    </template>
  </div>
</template>

<style scoped>
.fill { padding-bottom: calc(2rem + var(--safe-b)); }
.fill h1 { margin-top: 0.333rem; overflow-wrap: anywhere; }
.big-text { line-height: 1.5; }
.big-text p { margin: 0 0 10px; }
.big-text p:last-child { margin-bottom: 0; }
.q { margin-bottom: 0.444rem; }
.question { font-size: 1.222rem; font-weight: 700; margin-top: 0.222rem !important; overflow-wrap: anywhere; white-space: pre-wrap; }
.pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.foot { margin-top: 1rem; }
</style>
