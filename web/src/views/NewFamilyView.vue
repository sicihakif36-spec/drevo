<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api.js';

// Ссылка «Завести своё дерево» (server/src/routes/tenants.js): кто её открыл — владелец новой пустой семьи на этом сервере.
// Если телефон уже в других семьях, они остаются: переключаться — в «Профиль → Мои семьи».
const props = defineProps({ token: String });
const name = ref('');
const title = ref('');
const from = ref('');
const state = ref('checking'); // checking | ready | bad
const error = ref('');
const busy = ref(false);

onMounted(async () => {
  try {
    from.value = (await api('POST', '/api/tenant-links/check', { token: props.token })).from;
    state.value = 'ready';
  } catch (e) {
    error.value = e.message;
    state.value = e.status === 0 ? 'ready' : 'bad';
  }
});

async function create() {
  busy.value = true;
  error.value = '';
  try {
    await api('POST', '/api/tenant-links/redeem', { token: props.token, name: name.value, title: title.value });
    // Приложение открывается заново — уже в новой семье; первым делом оно попросит придумать пароль.
    if (typeof caches !== 'undefined') await caches.delete('tree').catch(() => {});
    location.replace('/');
  } catch (e) {
    error.value = e.message;
    busy.value = false;
  }
}
</script>

<template>
  <div class="page">
    <h1>Своё семейное дерево</h1>
    <p v-if="state === 'checking'" class="muted">Проверяю ссылку…</p>
    <div v-else-if="state === 'bad'" class="card">
      <p>{{ error }}</p>
      <p class="muted small">Ссылка срабатывает один раз. Если её уже открыли на другом телефоне, попросите новую.</p>
    </div>
    <div v-else class="card">
      <p>{{ from ? `${from} приглашает вас` : 'Вас приглашают' }} завести своё семейное дерево. Здесь вся семья вместе записывает родных,
        даты, фотографии и истории.</p>
      <p class="small">Дерево будет ваше: его увидят только те, кого вы сами позовёте. Вы станете его владельцем.</p>
      <label class="field"><span>Как вас зовут?</span><input v-model="name" autocomplete="name" placeholder="Например: Ольга" /></label>
      <label class="field"><span>Как назвать дерево?</span><input v-model="title" placeholder="Например: Род Галиевых" /></label>
      <p class="error" v-if="error">{{ error }}</p>
      <button class="primary block" :disabled="busy || !name.trim() || !title.trim()" @click="create">{{ busy ? 'Завожу…' : 'Завести дерево' }}</button>
      <p class="muted small">Ссылка срабатывает один раз. Если вы уже пользуетесь Древом в другой семье, она останется — переключаться можно в «Профиле».</p>
    </div>
  </div>
</template>
