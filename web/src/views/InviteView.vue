<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { store, loadMe, loadTree } from '../store.js';

const props = defineProps({ token: String });
const router = useRouter();
// Телефон уже в какой-то семье: приглашение добавит ещё одну, прежние останутся.
const before = computed(() => Boolean(store.me || store.tenants.length));
const name = ref('');
const error = ref('');
const busy = ref(false);

async function enter() {
  busy.value = true;
  error.value = '';
  try {
    const r = await api('POST', '/api/invites/redeem', { token: props.token, name: name.value });
    // Была открыта другая семья — приложение открывается заново, уже в этой.
    if (before.value) {
      if (typeof caches !== 'undefined') await caches.delete('tree').catch(() => {});
      location.replace('/');
      return;
    }
    await loadMe();
    // Вход на новом телефоне у того, кто правит дерево, ждёт пароль: экран пароля покажет App.vue.
    if (!r.password) await loadTree();
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
      <p v-if="before" class="muted small">Если вы уже пользуетесь Древом в другой семье, она останется — переключаться можно в «Профиле».</p>
    </div>
  </div>
</template>
