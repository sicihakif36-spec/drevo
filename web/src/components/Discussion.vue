<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { store, canTalk, canEdit, isOwner, toast, onLive } from '../store.js';
import { api } from '../api.js';
import { ask } from './ask.js';
import { openAsk } from '../asks.js';

// Обсуждение у карточки: воспоминания и комментарии родственников, а среди них — отмеченные вопросы родным
// (они хранятся отдельно, routes/asks.js) с ответами. Гостю вопросы не видны.
const props = defineProps({ person: Object });
const emit = defineEmits(['count']); // сколько сообщений — для закладки в карточке
const route = useRoute();
const root = ref(null);
const comments = ref([]);
const asks = ref([]);
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
  asks.value = [];
  if (props.person.hidden) return;
  try {
    [comments.value, asks.value] = await Promise.all([api('GET', `/api/persons/${props.person.id}/comments`), loadAsks()]);
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
const loadAsks = () => (canTalk() ? api('GET', `/api/persons/${props.person.id}/asks`) : []);
watch(() => props.person.id, load, { immediate: true });
// Сообщения и вопросы — вперемешку по времени.
const items = computed(() => [...comments.value.map((c) => ({ ...c, kind: 'comment' })), ...asks.value.map((a) => ({ ...a, kind: 'ask' }))]
  .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
watch([loaded, () => items.value.length], ([l, n]) => emit('count', l ? n : null), { immediate: true });

// Родственник написал здесь — перечитать тихо, не сбивая начатый ответ.
onUnmounted(onLive(async (events) => {
  if (!loaded.value) return;
  if (events.some((e) => e.kind === 'asks')) asks.value = await loadAsks();
  if (!events.some((e) => e.kind === 'comments' && (!e.person_id || e.person_id === props.person.id))) return;
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
  if (!await ask({ text: mine(c) ? 'Удалить ваше сообщение?' : `Удалить сообщение: ${c.user_name || 'кто-то'}?`, note: c.body.length > 120 ? `${c.body.slice(0, 120)}…` : c.body, yes: 'Удалить', no: 'Не удалять', danger: true })) return;
  try {
    await api('DELETE', `/api/comments/${c.id}`);
    comments.value = comments.value.filter((x) => x.id !== c.id);
  } catch (e) { toast(e.message); }
}

const mine = (c) => c.user_id === store.me?.id;
const filesText = (fs) => [fs.some((f) => f.kind === 'audio') && 'запись голоса', fs.filter((f) => f.kind === 'photo').length && `фото: ${fs.filter((f) => f.kind === 'photo').length}`].filter(Boolean).join(', ');
const when = (t) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
</script>

<template>
  <h2 ref="root" class="anchor">Обсуждение</h2>
  <div v-if="person.hidden" class="card muted small">Обсуждение живых родственников видно только участникам дерева.</div>
  <div v-else class="list talk">
    <div v-if="error" class="error">{{ error }}</div>
    <div v-else-if="!loaded" class="muted">Загрузка…</div>
    <template v-for="c in items" :key="c.kind + c.id">
      <div v-if="c.kind === 'ask'" class="msg askmsg">
        <div class="small"><span class="flag">Вопрос родным</span> <b>{{ c.from_name || 'Кто-то' }}</b> → <b>{{ c.to_name }}</b> <span class="muted">· {{ when(c.created_at) }}</span></div>
        <div class="pre q">{{ c.question }}</div>
        <template v-if="c.answered_at">
          <div class="small"><b>Ответ{{ c.to_name ? `: ${c.to_name}` : '' }}</b> <span class="muted">· {{ when(c.answered_at) }}</span></div>
          <div v-if="c.answer" class="pre">{{ c.answer }}</div>
          <div v-if="c.files.length" class="muted small">{{ filesText(c.files) }}</div>
        </template>
        <div v-else class="muted small">ждём ответа</div>
        <div class="row">
          <router-link v-if="c.to_user === store.me?.id && c.status === 'waiting'" :to="`/asks/${c.id}`" class="btn primary">Ответить</router-link>
          <router-link v-else :to="`/asks/${c.id}`" class="btn ghost open">{{ c.answered_at ? (canEdit() ? 'Открыть ответ — перенести в дерево' : 'Открыть ответ') : 'Открыть' }}</router-link>
        </div>
      </div>
      <div v-else class="msg">
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
          <div v-if="canTalk() && (mine(c) || isOwner())" class="row">
            <button v-if="mine(c)" class="ghost" @click="startEdit(c)">Изменить</button>
            <button class="ghost danger" @click="remove(c)">Удалить</button>
          </div>
        </template>
      </div>
    </template>
    <div v-if="loaded && !items.length" class="muted">{{ canTalk() ? 'Пока никто не писал. Поделитесь воспоминанием или спросите родных.' : 'Пока никто не писал.' }}</div>
    <form v-if="loaded && canTalk()" class="new" @submit.prevent="send">
      <textarea v-model="draft" maxlength="5000" placeholder="Напишите, что помните, или спросите родных" />
      <button class="primary block" :disabled="sending || !draft.trim()">{{ sending ? 'Отправляю…' : 'Отправить' }}</button>
    </form>
    <div v-if="loaded && canEdit()" class="new">
      <button class="block" @click="openAsk({ person: person.id })">Спросить у родных</button>
      <p class="muted small hint">Вопрос конкретному родственнику: придёт ему уведомлением или ссылкой.</p>
    </div>
  </div>
</template>

<style scoped>
.anchor { scroll-margin-top: 0.889rem; }
.talk > .msg, .talk > .new { display: block; }
.msg .pre { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 0.222rem; }
.msg > .row { margin: 0.222rem -1rem -0.444rem; }
.msg > .row .ghost:not(.danger) { color: var(--accent-text); }
.msg form textarea, .new textarea { margin: 0.444rem 0; }
.askmsg { box-shadow: inset 4px 0 var(--accent); }
.flag { display: inline-block; font-size: 0.778rem; font-weight: 700; padding: 0 0.444rem; border-radius: 999px; background: var(--accent-soft); color: var(--accent-soft-text); }
.askmsg .q { font-weight: 700; margin-bottom: 0.333rem; }
.askmsg > .row { margin: 0.333rem 0 0; }
.askmsg .btn { min-height: 2.667rem; font-size: 0.889rem; }
.askmsg .open { padding-left: 0; color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; border-color: transparent; background: transparent; }
.hint { margin: 0.333rem 0 0; }
</style>
