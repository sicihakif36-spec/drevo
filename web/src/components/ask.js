import { reactive } from 'vue';

// Своё окно вопроса вместо confirm()/prompt(): крупно, кнопки-глаголы.
// Одновременно открыто одно окно; новое закрывает прежнее ответом «нет».
export const askState = reactive({ open: false, text: '', note: '', yes: '', no: '', danger: false, input: null, label: '' });
let done = null;

function show(opts) {
  if (done) done(null);
  Object.assign(askState, { text: '', note: '', yes: 'Да', no: 'Отмена', danger: false, input: null, label: '' }, opts, { open: true });
  return new Promise((resolve) => { done = resolve; });
}

export function answer(value) {
  askState.open = false;
  const fn = done;
  done = null;
  fn?.(value);
}

// ask({ text: 'Удалить Петра из дерева?', note: 'Вернуть можно…', yes: 'Удалить', no: 'Не удалять', danger: true }) → true | false
export async function ask(opts) {
  return (await show(opts)) === true;
}

// Просто сообщение с одной кнопкой: tell('Не удалось загрузить…').
export const tell = (text, note = '') => show({ text, note, yes: 'Понятно', no: '' }).then(() => {});

// askText({ text: 'Как вас зовут в семье?', value: 'Лена', yes: 'Сохранить' }) → строка или null, если передумали
export async function askText(opts) {
  const r = await show({ yes: 'Сохранить', no: 'Отмена', ...opts, input: opts.value ?? '' });
  return typeof r === 'string' ? r : null;
}
