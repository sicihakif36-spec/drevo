// Компьютерный вид: боковое меню вместо нижней панели, широкие страницы, окна по центру.
// Граница — в em, как в style.css: при крупном шрифте браузера компьютерный вид включается позже.
import { ref } from 'vue';

export const WIDE = '(min-width: 64em)';
const mq = window.matchMedia(WIDE);
export const wide = ref(mq.matches);
mq.addEventListener('change', (e) => { wide.value = e.matches; });
