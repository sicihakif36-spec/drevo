<script setup>
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { store, canEdit } from '../store.js';
import { sections } from '../sections.js';
import { fullName, lifespan, personHas } from '@shared/names.js';
import Icon from './Icon.vue';

// Боковое меню на компьютере: найти человека, добавить, все разделы «Главной» и профиль внизу.
// На телефоне его нет — там нижняя панель (App.vue).
defineEmits(['add']);
const route = useRoute();

const query = ref('');
const found = computed(() => {
  const s = query.value.trim();
  return s && store.idx ? [...store.idx.persons.values()].filter((p) => personHas(p, s)).slice(0, 7) : [];
});

const family = computed(() => sections.value.find((g) => g.title === 'Семья')?.tiles || []);
const rest = computed(() => sections.value.filter((g) => !['Семья', 'Помощь'].includes(g.title)));

// Раздел подсвечен и на своих вложенных страницах: карточка человека — в «Людях», вопрос — в «Вопросах».
const NESTED = { '/people': ['/person/'], '/places': ['/place'], '/asks': ['/asks/'], '/surveys': ['/surveys/'], '/interviews': ['/interview/'] };
const on = (to) => route.path === to || (NESTED[to] || []).some((p) => route.path.startsWith(p));

const ROLE = { owner: 'владелец', editor: 'участник', relative: 'родственник', viewer: 'гость' };
const me = computed(() => String(store.me?.name || '').trim());
</script>

<template>
  <nav class="side" aria-label="Разделы">
    <router-link to="/" class="brand"><img src="/icon.svg" alt="" /><span>{{ store.title }}</span></router-link>

    <div v-if="store.idx?.persons.size" class="find">
      <label class="search">
        <Icon name="search" />
        <input v-model="query" type="search" placeholder="Найти человека" aria-label="Найти человека" autocomplete="off" @keydown.esc="query = ''" />
      </label>
      <div v-if="query.trim()" class="found">
        <router-link v-for="p in found" :key="p.id" :to="`/person/${p.id}`" @click="query = ''">
          <span>{{ fullName(p) }}</span><span class="muted small">{{ lifespan(p) }}</span>
        </router-link>
        <p v-if="!found.length" class="muted small">Никого не нашлось. Попробуйте только фамилию.</p>
      </div>
    </div>

    <button v-if="canEdit()" class="primary add" @click="$emit('add')"><Icon name="plus" />Добавить человека</button>

    <div class="group">
      <router-link to="/" class="item" :class="{ on: on('/') }"><Icon name="home" /><span class="grow">Главная</span></router-link>
      <router-link v-for="t in family" :key="t.title" :to="t.to" class="item" :class="{ on: on(t.to) }">
        <Icon :name="t.icon" /><span class="grow">{{ t.title }}</span><i v-if="t.dot" class="dot" aria-label="Есть новое"></i>
      </router-link>
    </div>
    <div v-for="g in rest" :key="g.title" class="group">
      <div class="gt">{{ g.title }}</div>
      <component :is="t.href ? 'a' : 'router-link'" v-for="t in g.tiles" :key="t.title" class="item" :class="{ on: t.to && on(t.to) }"
        v-bind="t.href ? { href: t.href, download: '' } : { to: t.to }">
        <Icon :name="t.icon" /><span class="grow">{{ t.title }}</span><i v-if="t.count" class="count">{{ t.count }}</i>
      </component>
    </div>

    <div class="foot">
      <router-link to="/help" class="item" :class="{ on: on('/help') }"><Icon name="help" /><span class="grow">Как пользоваться</span></router-link>
      <router-link to="/profile" class="item me" :class="{ on: on('/profile') }">
        <span class="avatar">{{ (me || '?')[0] }}</span>
        <span class="grow who"><b class="ellipsis">{{ me || 'Профиль' }}</b><span class="small muted">Профиль · {{ ROLE[store.me?.role] || 'участник' }}</span></span>
      </router-link>
    </div>
  </nav>
</template>

<style scoped>
.side {
  position: sticky; top: 0; flex: none; width: var(--side-w); height: 100vh; height: 100dvh; overflow-y: auto; overscroll-behavior: contain;
  display: flex; flex-direction: column; gap: 1rem; padding: 1.333rem 0.889rem 1.111rem;
  background: var(--card); border-right: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 0.667rem; padding: 0 0.333rem; color: var(--text); text-decoration: none; font-weight: 700; line-height: 1.2; }
.brand img { width: 2.444rem; height: 2.444rem; flex: none; border-radius: 0.667rem; }
.brand span { overflow-wrap: anywhere; }
.find { position: relative; }
.search { display: flex; align-items: center; gap: 0.444rem; padding: 0 0.667rem; background: var(--card); border: 1.5px solid var(--field); border-radius: var(--radius-s); }
.search:focus-within { border-color: var(--accent); outline: 3px solid var(--accent); outline-offset: 1px; }
.search svg { width: 1.222rem; height: 1.222rem; flex: none; color: var(--muted); }
.search input { border: 0; outline: none; background: transparent; padding-left: 0; padding-right: 0; min-height: 2.889rem; font-size: 0.944rem; }
.found { margin-top: 0.333rem; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius-s); overflow: hidden; }
.found a { display: flex; flex-direction: column; padding: 0.5rem 0.778rem; color: inherit; text-decoration: none; line-height: 1.3; border-top: 1px solid var(--line); }
.found a:first-child { border-top: 0; }
.found p { margin: 0; padding: 0.5rem 0.778rem; }
.add svg { width: 1.222rem; height: 1.222rem; }
.group { display: flex; flex-direction: column; gap: 0.111rem; }
.gt { font-size: 0.833rem; font-weight: 700; color: var(--muted); padding: 0.222rem 0.778rem; }
.item {
  display: flex; align-items: center; gap: 0.778rem; min-height: 2.556rem; padding: 0.25rem 0.778rem; border-radius: 0.667rem;
  color: var(--text); text-decoration: none; line-height: 1.25;
}
.item svg { width: 1.333rem; height: 1.333rem; flex: none; color: var(--muted); }
.item.on { background: var(--accent-soft); color: var(--accent-soft-text); font-weight: 700; }
.item.on svg { color: currentColor; }
@media (hover: hover) { .item:not(.on):hover, .found a:hover { background: var(--hover); } }
.dot { width: 0.556rem; height: 0.556rem; border-radius: 50%; background: var(--danger); flex: none; }
.count { min-width: 1.444rem; padding: 0 0.333rem; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-size: 0.778rem; font-style: normal; font-weight: 700; line-height: 1.444rem; text-align: center; }
.foot { margin-top: auto; padding-top: 0.778rem; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 0.111rem; }
.me { min-height: 3.333rem; }
.me .avatar { width: 2.444rem; height: 2.444rem; background: var(--accent-soft); color: var(--accent-soft-text); }
.me.on .avatar { background: var(--card); }
.who { display: flex; flex-direction: column; min-width: 0; }
.who .small { font-weight: 400; color: var(--muted); }
.me.on .who .small { color: var(--accent-soft-text); }
</style>
