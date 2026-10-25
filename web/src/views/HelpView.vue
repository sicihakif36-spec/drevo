<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { store } from '../store.js';
import { HELP } from '../help.js';

// «Ещё → Как пользоваться Древом»: разделы раскрываются по нажатию; каждому — только то, что ему можно (who в help.js).
// /help?s=<id> — сразу открыть нужный раздел.
const route = useRoute();
const ROLE = { owner: 'владелец', editor: 'участник', relative: 'родственник', viewer: 'гость' };
const role = computed(() => store.me?.role);
const fits = (who) => ({
  all: true,
  talk: role.value !== 'viewer',
  edit: ['owner', 'editor'].includes(role.value),
  owner: role.value === 'owner',
  admin: role.value === 'owner' && Boolean(store.tenant?.main),
  // Несколько семей — тем, кто в них состоит, и хозяину сервера.
  multi: store.tenants.length > 1 || (role.value === 'owner' && Boolean(store.tenant?.main)),
}[who]);
const sections = computed(() => HELP.filter((s) => fits(s.who)));
const open = ref(new Set(route.query.s ? [String(route.query.s)] : []));
const toggle = (id, e) => {
  const next = new Set(open.value);
  if (e.target.open) next.add(id);
  else next.delete(id);
  open.value = next;
};
// К разделу — после того, как роутер сам вернёт страницу наверх.
onMounted(() => {
  if (route.query.s) setTimeout(() => document.getElementById(`help-${route.query.s}`)?.scrollIntoView({ block: 'start' }), 100);
});
</script>

<template>
  <div class="page">
    <h1>Как пользоваться Древом</h1>
    <p class="muted">Нажмите на раздел, чтобы прочитать.<template v-if="role"> Вы — {{ ROLE[role] }}<template v-if="store.title"> в дереве «{{ store.title }}»</template>: здесь только то, что вам можно.</template></p>
    <div class="help">
      <details v-for="s in sections" :id="`help-${s.id}`" :key="s.id" :open="open.has(s.id)" @toggle="toggle(s.id, $event)">
        <summary>{{ s.title }}</summary>
        <div class="body">
          <template v-for="(b, i) in s.body" :key="i">
            <p v-if="typeof b === 'string'">{{ b }}</p>
            <ol v-else-if="b.steps"><li v-for="(t, j) in b.steps" :key="j">{{ t }}</li></ol>
            <ul v-else-if="b.list"><li v-for="(t, j) in b.list" :key="j">{{ t }}</li></ul>
          </template>
        </div>
      </details>
    </div>
  </div>
</template>

<style scoped>
.help { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
details + details { border-top: 1px solid var(--line); }
summary { display: flex; align-items: center; gap: 0.667rem; min-height: 3.333rem; padding: 0.667rem 1rem; cursor: pointer; font-weight: 700; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::after { content: '›'; margin-left: auto; font-size: 1.4rem; line-height: 1; color: var(--muted); transition: transform 0.15s; }
details[open] summary::after { transform: rotate(90deg); }
details[open] summary { color: var(--accent-text); }
.body { padding: 0 1rem 0.889rem; }
.body p { margin: 0 0 0.667rem; }
.body ol, .body ul { margin: 0 0 0.667rem; padding-left: 1.333rem; }
.body li { margin-bottom: 0.444rem; }
.body > :last-child { margin-bottom: 0; }
</style>
