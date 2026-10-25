<script setup>
import { useFeed } from '../feed.js';
import FeedItem from '../components/FeedItem.vue';

// «Что нового» целиком: кто что добавил и написал. Коротко то же — на «Главной» (HomeView), там же даты и вопросы вам.
const { feed, loaded, error } = useFeed();
</script>

<template>
  <div class="page">
    <h1>Что нового</h1>
    <div v-if="error" class="error">{{ error }}</div>
    <div v-else-if="!loaded" class="muted">Загрузка…</div>
    <div v-else class="list">
      <FeedItem v-for="it in feed" :key="it.kind + it.id" :it="it" />
      <div v-if="!feed.length" class="muted">Пока ничего не происходило</div>
    </div>
  </div>
</template>
