<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { loadMe, loadTree } from '../store.js';

const props = defineProps({ token: String });
const router = useRouter();
const name = ref('');
const error = ref('');
const busy = ref(false);

async function enter() {
  busy.value = true;
  error.value = '';
  try {
    await api('POST', '/api/invites/redeem', { token: props.token, name: name.value });
    await loadMe();
    await loadTree();
    router.replace('/');
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page">
    <h1>Добро пожаловать в семейное древо</h1>
    <div class="card">
      <p>Вас пригласили в закрытое семейное дерево. Здесь вся семья вместе записывает родных, даты и фотографии.</p>
      <label class="field"><span>Как вас зовут в семье?</span><input v-model="name" autocomplete="name" placeholder="Например: тётя Лена" /></label>
      <p class="error" v-if="error">{{ error }}</p>
      <button class="primary block" :disabled="busy" @click="enter">{{ busy ? 'Вхожу…' : 'Войти' }}</button>
      <p class="muted small">Ссылка срабатывает один раз. После входа добавьте приложение на главный экран, чтобы открывать его как обычное.</p>
    </div>
  </div>
</template>
