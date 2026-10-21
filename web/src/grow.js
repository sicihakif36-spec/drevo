// Поле, которое растёт по тексту: v-grow на textarea с классом line. Длинное место
// («деревня Горки, Ивановская волость, Старицкий уезд, Тверская губерния») видно целиком, а не обрезано.
function fit(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}

export const vGrow = {
  mounted(el) {
    fit(el);
    el.addEventListener('input', () => fit(el));
    // Ширина меняется (поворот телефона, окно открылось) — высота тоже.
    let width = el.clientWidth;
    el._grow = new ResizeObserver(() => {
      if (el.clientWidth !== width) fit(el);
      width = el.clientWidth;
    });
    el._grow.observe(el);
  },
  updated: fit,
  unmounted(el) { el._grow?.disconnect(); },
};
