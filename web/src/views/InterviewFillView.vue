<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api.js';
import InterviewRunner from '../components/InterviewRunner.vue';

// Интервью по ссылке: без входа и без дерева — только вопросы, по одному, и свои ответы. Можно отвечать в несколько заходов.
const props = defineProps({ token: String });
const H = { 'x-interview': props.token };
const state = ref('loading'); // loading | error | fill | saved
const error = ref('');
const data = ref(null);
const started = ref(false);

onMounted(async () => {
  document.title = 'Расскажите о семье';
  try {
    data.value = await api('GET', '/api/interview', undefined, H);
    state.value = data.value.saved ? 'saved' : 'fill';
    started.value = data.value.pos > 0 || Object.keys(data.value.answers).length > 0;
  } catch (e) {
    error.value = e.message;
    state.value = 'error';
  }
});
</script>

<template>
  <div class="page fill">
    <div v-if="state === 'loading'" class="muted">Загрузка…</div>

    <template v-else-if="state === 'error'">
      <h1>Расскажите о семье</h1>
      <div class="card big-text">{{ error }}</div>
    </template>

    <template v-else-if="state === 'saved'">
      <h1>Спасибо!</h1>
      <div class="card big-text">Ваши рассказы уже сохранены в семейном дереве. {{ data.from || 'Ваш родственник' }} их получил(а).</div>
    </template>

    <template v-else-if="!started">
      <h1>{{ data.from || 'Ваш родственник' }} просит вас рассказать о семье</h1>
      <div class="card big-text">
        <p>На экране будет по одному вопросу. Нажмите «Записать» и расскажите своими словами — сколько хочется, до 20 минут на ответ.</p>
        <p>Если не хочется отвечать — «Пропустить». Каждый ответ сохраняется сразу: можно прерваться и вернуться по этой же ссылке.</p>
        <p class="muted">Всего вопросов: {{ data.questions.length }}.</p>
      </div>
      <button class="primary block huge" @click="started = true">Начать</button>
    </template>

    <template v-else>
      <InterviewRunner base="/api/interview" :headers="H" :data="data" :scope="`iv-${token.slice(0, 16)}`" link>
        <template #done="{ answered }">
          <div class="card big-text done">
            <h2>Спасибо!</h2>
            <p>Записано ответов: <b>{{ answered }}</b>. {{ data.from || 'Ваш родственник' }} получит их и сохранит в семейном дереве.</p>
            <p class="muted">Захотите что-то добавить — откройте эту ссылку снова и выберите вопрос ниже.</p>
          </div>
        </template>
      </InterviewRunner>
    </template>
    <p v-if="state === 'fill'" class="muted small foot">Эта страничка — только для ответов. Семейное дерево по ней не открывается.</p>
  </div>
</template>

<style scoped>
.fill { padding-bottom: calc(2rem + var(--safe-b)); }
.fill h1 { margin-top: 0.333rem; overflow-wrap: anywhere; }
.big-text { line-height: 1.5; font-size: 1.056rem; }
.big-text p { margin: 0 0 10px; }
.big-text p:last-child { margin-bottom: 0; }
.huge { min-height: 3.556rem; font-size: 1.222rem; margin-top: 1rem; }
.done h2 { margin-top: 0; }
.foot { margin-top: 1.333rem; }
</style>
