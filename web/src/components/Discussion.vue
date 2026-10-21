<script setup>
import { nextTick, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { store, canEdit, isOwner, toast, onLive } from '../store.js';
import { api } from '../api.js';

// Обсуждение у карточки: воспоминания и комментарии родственников.
const props = defineProps({ person: Object });
const route = useRoute();
const root = ref(null);
const comments = ref([]);
const loaded = ref(false);
const error = ref('');
const draft = ref('');
const sending = ref(false);
const editId = ref(null);
const editText = ref('');

async function load() {
  loaded.value = false;
  error.value = '';
  comments.value = [];
  if (props.person.hidden) return;
  try {
    comments.value = await api('GET', `/api/persons/${props.person.id}/comments`);
    loaded.value = true;
    // Пришли из ленты — сразу к обсуждению.
    if (route.query.talk) {
      await nextTick();
      root.value?.scrollIntoView({ block: 'start' });
    }
  } catch (e) {
    error.value = e.message;
  }
}
watch(() => props.person.id, load, { immediate: true });

// Родственник написал здесь — перечитать тихо, не сбивая начатый ответ.
onUnmounted(onLive(async (events) => {
  if (!loaded.value || !events.some((e) => e.kind === 'comments' && (!e.person_id || e.person_id === props.person.id))) return;
  comments.value = await api('GET', `/api/persons/${props.person.id}/comments`);
}));

async function send() {
  sending.value = true;
  try {
    comments.value.push(await api('POST', `/api/persons/${props.person.id}/comments`, { body: draft.value }));
    draft.value = '';
  } catch (e) { toast(e.message); }
  sending.value = false;
}

function startEdit(c) {
  editId.value = c.id;
  editText.value = c.body;
}

async function saveEdit(c) {
  try {
    Object.assign(c, await api('PATCH', `/api/comments/${c.id}`, { body: editText.value }));
    editId.value = null;
  } catch (e) { toast(e.message); }
}

async function remove(c) {
  if (!confirm('Удалить этот комментарий?')) return;
  try {
    await api('DELETE', `/api/comments/${c.id}`);
    comments.value = comments.value.filter((x) => x.id !== c.id);
  } catch (e) { toast(e.message); }
}

const mine = (c) => c.user_id === store.me?.id;
const when = (t) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
</script>

<template>
  <h2 ref="root" class="anchor">Обсуждение</h2>
  <div v-if="person.hidden" class="card muted small">Обсуждение живых родственников видно только участникам дерева.</div>
  <div v-else class="list talk">
    <div v-if="error" class="error">{{ error }}</div>
    <div v-else-if="!loaded" class="muted">Загрузка…</div>
    <div v-for="c in comments" :key="c.id" class="msg">
      <div class="small"><b>{{ c.user_name || 'Кто-то' }}</b> <span class="muted">· {{ when(c.created_at) }}<template v-if="c.updated_at"> · изменено</template></span></div>
      <form v-if="editId === c.id" @submit.prevent="saveEdit(c)">
        <textarea v-model="editText" maxlength="5000" />
        <div class="row">
          <button type="button" class="grow" @click="editId = null">Отмена</button>
          <button class="primary grow" :disabled="!editText.trim()">Сохранить</button>
        </div>
      </form>
      <template v-else>
        <div class="pre">{{ c.body }}</div>
        <div v-if="canEdit() && (mine(c) || isOwner())" class="row">
          <button v-if="mine(c)" class="ghost" @click="startEdit(c)">Изменить</button>
          <button class="danger" @click="remove(c)">Удалить</button>
        </div>
      </template>
    </div>
    <div v-if="loaded && !comments.length" class="muted">{{ canEdit() ? 'Пока никто не писал. Поделитесь воспоминанием или спросите родных.' : 'Пока никто не писал.' }}</div>
    <form v-if="loaded && canEdit()" class="new" @submit.prevent="send">
      <textarea v-model="draft" maxlength="5000" placeholder="Воспоминание, вопрос или уточнение" />
      <button class="primary block" :disabled="sending || !draft.trim()">{{ sending ? 'Отправляю…' : 'Отправить' }}</button>
    </form>
  </div>
</template>

<style scoped>
.anchor { scroll-margin-top: 16px; }
.talk > .msg, .talk > .new { display: block; }
.msg .pre { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 4px; font-size: 17px; }
.msg > .row { margin: 4px -12px -8px; }
.msg form textarea, .new textarea { margin: 8px 0; }
</style>
