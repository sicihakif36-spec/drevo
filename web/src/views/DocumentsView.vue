<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { toast } from '../store.js';
import { api } from '../api.js';
import { KINDS } from '@shared/sources.js';
import DocPicker from '../components/DocPicker.vue';
import SourceForm from '../components/SourceForm.vue';

// Документы: метрические книги, ревизские сказки, дела из архивов — каждый записан один раз, у него страницы
// с людьми. Отсюда — открыть документ, исправить или объединить двойники, завести новый заранее.
const router = useRouter();
const step = ref('list'); // list, kind, form
const kind = ref('');
const busy = ref('');
const error = ref('');

async function create({ doc }) {
  busy.value = 'Сохраняю…';
  error.value = '';
  try {
    const d = await api('POST', '/api/documents', doc);
    toast('Документ записан');
    router.push(`/documents/${d.id}`);
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <div class="page">
    <div class="row" style="margin-bottom:8px">
      <button class="ghost" aria-label="Назад" @click="step === 'list' ? router.back() : (step = step === 'form' ? 'kind' : 'list')">‹ Назад</button>
    </div>
    <template v-if="step === 'list'">
      <h1>Документы</h1>
      <p class="muted small">Метрические книги, ревизские сказки, дела из архивов. Документ записывается один раз — название и шифр
        дела, — а у каждого человека указывается своя страница: лист, номер записи, скан.</p>
      <DocPicker @pick="(d) => router.push(`/documents/${d.id}`)" />
      <button class="primary block" style="margin-top:12px" @click="step = 'kind'">+ Новый документ</button>
    </template>
    <template v-else-if="step === 'kind'">
      <h1>Новый документ</h1>
      <p class="muted">Что это за источник?</p>
      <div class="kinds">
        <button v-for="(k, key) in KINDS" :key="key" type="button" @click="kind = key; error = ''; step = 'form'">{{ k.label }}</button>
      </div>
    </template>
    <template v-else>
      <h1>{{ KINDS[kind].label }}</h1>
      <SourceForm :kind="kind" doc :busy="busy" :error="error" @submit="create" @cancel="step = 'kind'" />
    </template>
  </div>
</template>

<style scoped>
.kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.kinds button { min-height: 60px; font-size: 0.889rem; }
</style>
