<script setup>
// Как поставить Древо значком на экран — для этого телефона: кнопка браузера, шаги для iPhone или Android,
// а из браузера мессенджера — сначала открыть в обычном браузере.
import { install, isIos, inApp, promptInstall } from '../install.js';
</script>

<template>
  <p v-if="inApp" class="small">Сейчас Древо открыто внутри мессенджера — отсюда значок не поставить. Нажмите «⋯» или «⋮» вверху →
    «Открыть в браузере»{{ isIos ? ' (Safari)' : '' }} и поставьте значок там.</p>
  <button v-else-if="install.event" class="primary block" @click="promptInstall">Установить</button>
  <p v-else-if="isIos" class="small">В Safari нажмите «Поделиться» (квадрат со стрелкой вверх) → «На экран „Домой“» → «Добавить».</p>
  <p v-else class="small">Нажмите меню браузера (три точки справа вверху) → «Установить приложение» или «Добавить на главный экран».</p>
</template>
