// Требования к паролю: одни для телефона (подсказка сразу) и сервера (проверка при сохранении).

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

// Самые частые пароли: их пробуют первыми.
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'qwerty12', 'qwerty123', 'qwerty1234', 'qwertyuiop',
  '1q2w3e4r', '1q2w3e4r5t', '1q2w3e4r5t6y', 'q1w2e3r4', 'q1w2e3r4t5', '1qaz2wsx', 'zaq12wsx', 'qazwsxedc', '123qweasd',
  '123qweasdzxc', 'qwe12345', '1234qwer', 'qwer1234', 'asdf1234', 'abc12345', 'abcd1234', 'a1234567', 'q1234567',
  '1234567q', '123456789a', '123456qwerty', 'qwerty123456', 'iloveyou', 'iloveyou1', 'sunshine', 'princess',
  'football', 'baseball', 'welcome1', 'admin123', 'administrator', 'letmein1', 'trustno1', 'dragon12',
  'parol123', 'пароль123', 'пароль12345', 'йцукенгш', 'qwertyui', 'asdfghjk', 'zxcvbnm1',
  '12341234', '11223344', '12344321', '123123123', '147258369', '159357456', '789456123', '741852963', '1234554321',
  '12345qwert', 'marina12', 'natasha1', 'nikita12', 'love1234', 'drevo123', 'semya123',
]);
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю', 'abcdefghijklmnopqrstuvwxyz',
  'абвгдеёжзийклмнопрстуфхцчшщъыьэюя', '01234567890'];

// Повтор короткого куска: «abababab», «12121212», «123123123».
const repeated = (s) => [1, 2, 3].some((n) => s.length >= n * 2 && s === s.slice(0, n).repeat(Math.ceil(s.length / n)).slice(0, s.length));
// Подряд по клавиатуре или по алфавиту, в любую сторону: «12345678», «87654321», «asdfghjk».
const inRow = (s) => ROWS.some((row) => row.includes(s) || [...row].reverse().join('').includes(s));

// Что не так с паролем — понятным текстом, или пустая строка, если годится.
export function passwordProblem(password) {
  const s = String(password ?? '');
  if (s.length < MIN_PASSWORD) return `Нужно не меньше ${MIN_PASSWORD} знаков`;
  if (s.length > MAX_PASSWORD) return 'Слишком длинный пароль';
  const low = s.toLowerCase();
  if (repeated(low)) return 'Слишком простой: повтор одних и тех же знаков';
  if (inRow(low)) return 'Слишком простой: знаки подряд, как на клавиатуре';
  if (COMMON.has(low)) return 'Слишком простой: такой пароль пробуют первым';
  return '';
}
