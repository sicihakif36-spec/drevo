<script setup>
import { ref, watch, nextTick } from 'vue';
import { askState, answer } from './ask.js';

const box = ref(null);
const field = ref(null);
const value = ref('');

watch(() => askState.open, async (open) => {
  if (!open) return;
  value.value = askState.input ?? '';
  await nextTick();
  // Фокус на поле ввода или на безопасной кнопке «не надо», чтобы случайный Enter ничего не удалил.
  (field.value || box.value?.querySelector('.ask-no'))?.focus();
});

function yes() {
  answer(askState.input === null ? true : value.value);
}
function no() {
  answer(askState.input === null ? false : null);
}
</script>

<template>
  <template v-if="askState.open">
    <div class="ask-backdrop" @click="no"></div>
    <div class="ask" ref="box" role="alertdialog" aria-modal="true" aria-labelledby="ask-text" @keydown.esc="no">
      <p id="ask-text" class="ask-text">{{ askState.text }}</p>
      <p v-if="askState.note" class="ask-note">{{ askState.note }}</p>
      <form v-if="askState.input !== null" @submit.prevent="yes">
        <label class="field">
          <span v-if="askState.label">{{ askState.label }}</span>
          <input ref="field" v-model="value" :aria-label="askState.label || askState.text" />
        </label>
      </form>
      <!-- Опасное действие — красная кнопка, но второй: первой и с фокусом стоит «не надо». -->
      <div class="ask-buttons" v-if="askState.danger">
        <button class="ask-no" @click="no">{{ askState.no }}</button>
        <button class="danger-fill" @click="yes">{{ askState.yes }}</button>
      </div>
      <div class="ask-buttons" v-else>
        <button class="primary" :class="{ 'ask-no': !askState.no }" @click="yes">{{ askState.yes }}</button>
        <button v-if="askState.no" class="ask-no" @click="no">{{ askState.no }}</button>
      </div>
    </div>
  </template>
</template>

<style scoped>
.ask-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 70; }
.ask {
  position: fixed; z-index: 71; left: 1rem; right: 1rem; top: 50%; transform: translateY(-50%);
  max-width: 480px; margin: 0 auto; max-height: calc(100vh - 2rem); overflow-y: auto;
  background: var(--card); border-radius: var(--radius); padding: 1.333rem 1.111rem 1.111rem;
  border: 1px solid var(--field); box-shadow: 0 8px 40px rgba(0,0,0,.35);
}
.ask-text { font-size: 1.111rem; font-weight: 700; line-height: 1.35; margin: 0 0 0.5rem; overflow-wrap: anywhere; }
.ask-note { color: var(--muted); margin: 0 0 0.5rem; white-space: pre-line; overflow-wrap: anywhere; }
.ask-buttons { display: grid; gap: 0.667rem; margin-top: 1.111rem; }
.ask-buttons button { width: 100%; min-height: 3.111rem; }
.danger-fill { background: var(--danger); border-color: var(--danger); color: var(--card); }
</style>
