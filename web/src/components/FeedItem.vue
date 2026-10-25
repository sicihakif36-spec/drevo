<script setup>
import { ref } from 'vue';
import { thumbUrl } from '../api.js';
import { moreText } from '../history.js';

// Один пункт «Что нового» (src/feed.js): правка, сообщение в обсуждении, ответ на вопрос, заполненная анкета.
// Ставится внутрь .list.
defineProps({ it: Object });
const open = ref(false); // раскрыты ли «Ещё N изменений»
const when = (t) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
</script>

<template>
  <router-link v-if="it.kind === 'comment'" :to="`/person/${it.person_id}?talk=1`" :class="{ fresh: it.fresh }">
    <div class="grow">
      <div class="small muted">{{ when(it.at) }}<span v-if="it.fresh" class="badge">новое</span></div>
      <div><b>{{ it.user_name || 'Кто-то' }}:</b> в обсуждении у {{ it.who }}</div>
      <div class="quote">{{ it.body }}</div>
    </div>
    <span class="muted" aria-hidden="true">›</span>
  </router-link>
  <router-link v-else-if="it.kind === 'answer'" :to="`/asks/${it.id}`" :class="{ fresh: it.fresh }">
    <div class="grow">
      <div class="small muted">{{ when(it.at) }}<span v-if="it.fresh" class="badge">новое</span></div>
      <div><b>{{ it.who || 'Родственник' }}</b> — ответ на ваш вопрос</div>
      <div class="small muted">{{ it.about }}</div>
      <div class="quote">{{ it.answer || 'Фото или запись голоса' }}</div>
    </div>
    <span class="muted" aria-hidden="true">›</span>
  </router-link>
  <router-link v-else-if="it.kind === 'survey'" :to="`/surveys/${it.id}`" :class="{ fresh: it.fresh }">
    <div class="grow">
      <div class="small muted">{{ when(it.at) }}<span v-if="it.fresh" class="badge">новое</span></div>
      <div v-if="it.sex === 'F' || it.sex === 'M'"><b>{{ it.name }}</b> {{ it.sex === 'F' ? 'заполнила' : 'заполнил' }} анкету о семье</div>
      <div v-else>Заполнена анкета о семье: <b>{{ it.name }}</b></div>
      <div class="muted small">Посмотрите ответы и загрузите их в дерево</div>
    </div>
    <span class="muted" aria-hidden="true">›</span>
  </router-link>
  <div v-else class="op" :class="{ fresh: it.fresh }">
    <div class="small muted">{{ when(it.at) }}<span v-if="it.fresh" class="badge">новое</span></div>
    <div class="line"><b>{{ it.user_name || 'Кто-то' }}:</b> {{ it.lines[0] }}</div>
    <div v-if="it.photos?.length" class="thumbs">
      <img v-for="id in it.photos" :key="id" :src="thumbUrl(id)" alt="" loading="lazy" />
    </div>
    <template v-if="open">
      <div v-for="(l, i) in it.lines.slice(1)" :key="i" class="line more-line">{{ l }}</div>
    </template>
    <button v-if="it.lines.length > 1" class="ghost more" :aria-expanded="open" @click="open = !open">
      {{ open ? 'Свернуть' : moreText(it.lines.length - 1) }}
    </button>
  </div>
</template>

<style scoped>
.fresh { box-shadow: inset 4px 0 var(--accent); }
.op { display: block !important; }
.line { overflow-wrap: anywhere; }
.more-line { margin-top: 0.222rem; padding-left: 0.667rem; border-left: 3px solid var(--line); }
.more { color: var(--accent-text); padding-left: 0; padding-right: 0; text-decoration: underline; text-underline-offset: 3px; }
.thumbs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.333rem; margin-top: 0.444rem; max-width: 22rem; }
.thumbs img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 0.556rem; background: var(--line); display: block; }
.quote { margin-top: 0.111rem; color: var(--muted); font-style: italic; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.badge { margin-left: 0.444rem; padding: 0.056rem 0.5rem; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-size: 0.778rem; font-weight: 700; }
</style>
