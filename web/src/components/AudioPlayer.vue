<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';

// Плеер записи голоса: крупная кнопка и полоска, которую можно двигать пальцем.
// duration — длительность, известная заранее: в записи с телефона Android её часто нет, и браузер показывает «бесконечность».
const props = defineProps({ src: String, duration: Number });
const audio = ref(null);
const playing = ref(false);
const time = ref(0);
const real = ref(0);
const error = ref('');

const total = computed(() => (Number.isFinite(real.value) && real.value > 0 ? real.value : props.duration || 0));
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function toggle() {
  const a = audio.value;
  if (a.paused) a.play().catch(() => { error.value = 'Эта запись не играет на этом телефоне.'; });
  else a.pause();
}
function seek(e) {
  audio.value.currentTime = Number(e.target.value);
  time.value = audio.value.currentTime;
}
// Запись кончилась, а длительность была неизвестна — теперь она известна.
function ended() {
  playing.value = false;
  if (!total.value) real.value = time.value;
}

watch(() => props.src, () => { playing.value = false; time.value = 0; real.value = 0; error.value = ''; });
onUnmounted(() => audio.value?.pause());
</script>

<template>
  <div class="player">
    <audio ref="audio" :src="src" preload="metadata"
      @play="playing = true" @pause="playing = false" @ended="ended"
      @timeupdate="time = $event.target.currentTime" @durationchange="real = $event.target.duration"
      @error="error = 'Эта запись не играет на этом телефоне.'" />
    <button type="button" class="play" :aria-label="playing ? 'Пауза' : 'Слушать'" @click="toggle">
      <svg v-if="playing" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
      <svg v-else viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
    </button>
    <div class="grow">
      <input type="range" min="0" :max="total || 1" step="0.1" :value="time" :disabled="!total" aria-label="Место в записи" @input="seek" />
      <div class="muted small">{{ clock(time) }}<template v-if="total"> из {{ clock(total) }}</template></div>
      <div v-if="error" class="error">{{ error }}</div>
    </div>
  </div>
</template>

<style scoped>
.player { display: flex; align-items: center; gap: 14px; }
.play { flex: none; width: 3.556rem; height: 3.556rem; min-height: 0; padding: 0; border-radius: 50%; background: var(--accent); border-color: var(--accent); color: var(--on-accent); display: grid; place-items: center; }
.play svg { width: 1.667rem; height: 1.667rem; fill: currentColor; }
input[type=range] { width: 100%; padding: 0; height: 32px; min-height: 0; border: 0; background: transparent; }
.error { margin: 4px 0 0; }
</style>
