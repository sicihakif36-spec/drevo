<script setup>
// «Есть ссылка?»: открыть ссылку на Древо прямо здесь. Ссылка из сообщения открывается там, где решит телефон —
// в браузере, а не в приложении на экране «Домой» (на iPhone у него свои входы). Вставили сюда — и она сработает здесь.
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const text = ref('');
const error = ref('');
// Ссылки Древа: приглашение, «Завести своё дерево», «Войти в другом месте», анкета, вопрос, интервью.
const LINK = /#\/(invite|new|carry|survey|ask|iv)\/([\w.-]{20,})/;
const canPaste = Boolean(navigator.clipboard?.readText);

async function paste() {
  try { text.value = (await navigator.clipboard.readText()).trim(); } catch { return; }
  if (text.value) open();
}

function open() {
  error.value = '';
  const s = text.value.trim();
  const m = LINK.exec(s);
  if (!m) {
    error.value = 'Это не ссылка на Древо. Скопируйте ссылку из сообщения целиком.';
    return;
  }
  let host = location.host;
  try { host = new URL(s).host; } catch { /* только хвост ссылки — значит, сюда */ }
  if (host !== location.host) {
    error.value = 'Эта ссылка — на другой сервер. Откройте её в браузере.';
    return;
  }
  router.push(`/${m[1]}/${m[2]}`);
}
</script>

<template>
  <div class="paste">
    <div class="row">
      <input v-model="text" class="grow" inputmode="url" autocomplete="off" placeholder="Вставьте ссылку" aria-label="Ссылка на Древо" @keydown.enter="open" />
      <button v-if="canPaste && !text.trim()" @click="paste">Вставить</button>
      <button v-else class="primary" :disabled="!text.trim()" @click="open">Открыть</button>
    </div>
    <p class="error" v-if="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.error { margin: 0.333rem 0 0; }
</style>
