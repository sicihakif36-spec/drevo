<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { store } from '../store.js';
import { api } from '../api.js';
import { fullName, lifespan } from '@shared/names.js';

// Печать карточки человека на A4: что включить и оформление. Сам лист собирает сервер (GET /api/persons/:id/card.pdf).
const props = defineProps({ id: String });
const router = useRouter();
const p = computed(() => store.idx?.persons.get(props.id));

const saved = (() => { try { return JSON.parse(localStorage.getItem('drevo.card') || '{}'); } catch { return {}; } })();
const o = reactive({ theme: 'classic', stories: true, photos: true, docs: true, sources: true, ...saved });
watch(o, () => { try { localStorage.setItem('drevo.card', JSON.stringify(o)); } catch {} });

// Сколько чего есть — подписи к галочкам; у гостя про живого всё равно пусто.
const counts = ref(null);
watch(() => props.id, async (id) => {
  counts.value = null;
  if (!p.value || p.value.hidden) return;
  const get = (url) => api('GET', url).catch(() => null);
  const [media, stories, sources] = await Promise.all([get(`/api/persons/${id}/media`), get(`/api/persons/${id}/stories`), get(`/api/persons/${id}/sources`)]);
  if (props.id !== id) return;
  counts.value = {
    stories: stories?.length ?? 0,
    photos: media?.filter((m) => m.kind === 'photo').length ?? 0,
    docs: media?.filter((m) => m.kind === 'doc').length ?? 0,
    sources: sources?.sources?.length ?? 0,
  };
}, { immediate: true });

const PARTS = [['stories', 'Истории'], ['photos', 'Фото из альбома'], ['docs', 'Документы'], ['sources', 'Источники']];
const url = (download) => {
  const qs = new URLSearchParams({ theme: o.theme });
  for (const [k] of PARTS) qs.set(k, o[k] ? '1' : '0');
  if (download) qs.set('download', '1');
  return `/api/persons/${props.id}/card.pdf?${qs}`;
};
</script>

<template>
  <div class="page">
    <div class="row" style="margin-bottom:8px">
      <button class="ghost" @click="router.back()" aria-label="Назад">‹ Назад</button>
    </div>
    <h1>Печать карточки</h1>
    <div v-if="!p" class="muted">{{ store.tree ? 'Человек не найден или удалён.' : 'Загрузка…' }}</div>
    <template v-else>
      <div class="card">
        <b>{{ fullName(p) }}</b> <span class="muted">{{ lifespan(p) }}</span>
        <p class="muted small" style="margin:6px 0 0">Лист A4: фото, даты и места, жизнь по годам, родители, супруги, дети, братья и сёстры.
          Если не поместится на одну страницу — продолжится на следующей.</p>
      </div>

      <div class="row" style="margin:12px 0">
        <a class="btn primary grow" :href="url(false)" target="_blank">Открыть PDF</a>
        <a class="btn grow" :href="url(true)">Скачать</a>
      </div>

      <template v-if="!p.hidden">
        <h2>Что добавить</h2>
        <label v-for="[k, label] in PARTS" :key="k" class="row check">
          <input type="checkbox" v-model="o[k]" />
          <b class="grow">{{ label }}</b>
          <i v-if="counts" class="muted small">{{ counts[k] || 'нет' }}</i>
        </label>
        <p class="muted small">Истории печатаются текстом; если есть запись голоса — будет пометка. Фото — до 12 небольших с подписями.</p>
      </template>
      <p v-else class="muted small">Даты, места и фото живых родственников видны только участникам дерева — на листе будут имя и родные.</p>

      <h2>Оформление</h2>
      <div class="chips">
        <button class="chip" :class="{ on: o.theme === 'classic' }" @click="o.theme = 'classic'">Классика</button>
        <button class="chip" :class="{ on: o.theme === 'modern' }" @click="o.theme = 'modern'">Современное</button>
        <button class="chip" :class="{ on: o.theme === 'bw' }" @click="o.theme = 'bw'">Чёрно-белое</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.check { min-height: 48px; padding: 4px 0; gap: 12px; }
.check input { width: 22px; height: 22px; min-height: 0; margin: 0; }
.check b { font-weight: 400; }
.check i { font-style: normal; }
</style>
