<script setup>
// Ссылка «Войти в другом месте» («Профиль»): вход здесь сразу во все семьи, где человек вошёл там.
// В ссылке — ключи обычных ссылок для нового телефона, по одному на семью (server/src/routes/tenants.js, /api/tenants/carry).
import { ref } from 'vue';
import { api } from '../api.js';

const props = defineProps({ tokens: String });
const tokens = props.tokens.split('.').filter((t) => t.length >= 20 && t.length <= 100);
const error = ref('');
const busy = ref(false);

async function enter() {
  busy.value = true;
  error.value = '';
  let ok = 0;
  for (const token of tokens) {
    try {
      await api('POST', '/api/invites/redeem', { token });
      ok++;
    } catch (e) {
      if (e.status === 0 || e.status === 429) {
        error.value = e.status === 0 ? 'Нет связи с сервером. Попробуйте ещё раз, когда появится интернет.' : e.message;
        if (!ok) { busy.value = false; return; }
        break;
      }
    }
  }
  if (!ok) {
    error.value = 'Ссылка уже сработала или прошли сутки. Сделайте новую там, где у вас открывается Древо: «Профиль → Войти в другом месте».';
    busy.value = false;
    return;
  }
  // Приложение открывается заново, уже со всеми семьями; кто правит дерево, введёт пароль.
  if (typeof caches !== 'undefined') await caches.delete('tree').catch(() => {});
  location.replace('/');
}
</script>

<template>
  <div class="page">
    <h1>Вход в ваши семьи</h1>
    <div class="card">
      <p>По этой ссылке вы войдёте в Древо здесь — сразу {{ tokens.length > 1 ? `во все ваши семьи (${tokens.length})` : 'в вашу семью' }}, как там, где сделали ссылку.</p>
      <p class="small">Если вы правите дерево, здесь попросят ваш пароль.</p>
      <p class="error" v-if="error">{{ error }}</p>
      <button class="primary block" :disabled="busy || !tokens.length" @click="enter">{{ busy ? 'Вхожу…' : 'Войти' }}</button>
      <p class="muted small">Ссылка срабатывает один раз и действует сутки. Там, где её сделали, всё останется как было.</p>
    </div>
  </div>
</template>
