<script setup>
import { nextTick, ref } from 'vue';

// Поколенная роспись текстом — та же сборка, что в PDF (shared/rospis.js). Номера — переходы к записи,
// после перехода — кнопка «Вернуться».
const props = defineProps({ r: Object });
const box = ref(null);
const back = ref(null); // откуда перешли: номер записи или 'index'
const lit = ref(0);

function show(id) {
  const el = box.value?.querySelector(`[data-at="${id}"]`);
  if (!el) return;
  box.value.scrollTo({ top: el.offsetTop - box.value.offsetTop - 8, behavior: 'smooth' });
}
async function go(n, from) {
  back.value = from;
  lit.value = n;
  await nextTick();
  show(n);
  setTimeout(() => { if (lit.value === n) lit.value = 0; }, 1600);
}
function goBack() {
  const to = back.value;
  back.value = null;
  if (to) show(to);
}
</script>

<template>
  <div class="wrap">
    <div ref="box" class="rospis">
      <h3 class="title">{{ r.title }}</h3>
      <p class="sub">{{ r.subtitle }}</p>
      <p v-for="(parts, i) in r.intro" :key="'i' + i" class="intro">
        <template v-for="(x, j) in parts" :key="j"><b v-if="x.b">{{ x.t }}</b><template v-else>{{ x.t }}</template></template>
      </p>
      <template v-for="g in r.gens" :key="g.n">
        <h4 class="gen">{{ g.title }}</h4>
        <div v-for="e in g.entries" :key="e.num" class="entry" :class="{ lit: lit === e.num }" :data-at="e.num">
          <p v-for="(p, i) in e.paras" :key="i" :class="p.kind">
            <template v-for="(x, j) in p.parts" :key="j">
              <a v-if="x.ref" href="#" class="ref" @click.prevent="go(x.ref, e.num)">{{ x.t }}</a>
              <b v-else-if="x.b">{{ x.t }}</b>
              <template v-else>{{ x.t }}</template>
            </template>
          </p>
        </div>
      </template>
      <h4 class="gen" data-at="index">Указатель имён</h4>
      <template v-for="(x, i) in r.index" :key="x.id + (x.alt ? ':alt' : '')">
        <div v-if="!i || r.index[i - 1].letter !== x.letter" class="letter">{{ x.letter }}</div>
        <p class="ix">
          <template v-for="(y, j) in x.parts" :key="j">
            <a v-if="y.ref" href="#" class="ref" :class="{ own: y.b }" @click.prevent="go(y.ref, 'index')">{{ y.t }}</a>
            <template v-else>{{ y.t }}</template>
          </template>
        </p>
      </template>
    </div>
    <div class="bar">
      <button v-if="back" class="btn small-btn" @click="goBack">‹ Вернуться {{ back === 'index' ? 'к указателю' : `к № ${back}` }}</button>
      <button class="btn ghost small-btn" @click="go('index', back)">Указатель</button>
    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; }
.rospis { max-height: 65vh; overflow-y: auto; padding: 0.889rem 1rem 1.5rem; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
  font-family: "DejaVu Serif", "PT Serif", Georgia, serif; line-height: 1.45; overflow-wrap: anywhere; }
.title { text-align: center; margin: 0.25rem 0 0; font-size: 1.444rem; }
.sub { text-align: center; color: var(--muted); margin: 0.25rem 0 0.889rem; }
.intro { margin: 0 0 0.444rem; }
.gen { text-align: center; color: var(--accent-text); font-size: 1.222rem; margin: 1.333rem 0 0.667rem; border-bottom: 1px solid var(--line); padding-bottom: 0.25rem; }
.entry { margin: 0 0 0.889rem; padding: 0.222rem 0.333rem; border-radius: var(--radius-s); transition: background 0.4s; }
.entry.lit { background: var(--accent-soft); }
.entry p { margin: 0.222rem 0 0 1.111rem; }
.entry p.head { margin-left: 0; }
.entry p.head b { color: var(--text); }
.entry p.note, .entry p.source { color: var(--muted); font-size: 0.889rem; }
.ref { color: var(--accent-text); font-weight: 700; text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; }
.letter { color: var(--accent-text); font-weight: 700; margin: 0.667rem 0 0.111rem; }
.ix { margin: 0 0 0.111rem 0.889rem; text-indent: -0.889rem; padding-left: 0.889rem; }
.ix .ref { font-weight: 400; }
.ix .ref.own { font-weight: 700; }
.bar { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.444rem; flex-wrap: wrap; }
.small-btn { min-height: 2.667rem; font-size: 0.889rem; }
</style>
