// Устройство понятными словами по строке браузера (user-agent): «Android, Chrome», «iPhone, Safari».
// Без внешних служб: только то, что браузер сам о себе сообщает. Точной модели телефона здесь нет.

const SYSTEMS = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/HarmonyOS/, 'Huawei'],
  [/CrOS/, 'Chromebook'],
  [/Windows/, 'Windows'],
  [/Macintosh|Mac OS X/, 'Mac'],
  [/Linux/, 'Linux'],
];
// Порядок важен: многие браузеры называют себя ещё и «Chrome», «Safari».
const BROWSERS = [
  [/YaBrowser|YaApp/, 'Яндекс Браузер'],
  [/SamsungBrowser/, 'Samsung Internet'],
  [/MiuiBrowser|XiaoMi/, 'браузер Xiaomi'],
  [/HuaweiBrowser/, 'браузер Huawei'],
  [/OPR\/|Opera|OPiOS/, 'Opera'],
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/Firefox|FxiOS/, 'Firefox'],
  [/CriOS|Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

export function deviceName(ua) {
  const s = String(ua || '');
  const system = SYSTEMS.find(([re]) => re.test(s))?.[1];
  const browser = BROWSERS.find(([re]) => re.test(s))?.[1];
  return [system, browser].filter(Boolean).join(', ') || 'Неизвестное устройство';
}
