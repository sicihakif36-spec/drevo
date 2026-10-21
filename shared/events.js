// События ленты жизни: виды и их поля. Общий код телефона (форма, лента) и сервера (проверка, GEDCOM).
// Новый вид — строчка здесь: title и hint — подпись и подсказка к полю «что именно» (main — оно в короткой форме),
// place — своя подпись к месту, military — ещё часть и звание,
// gedcom — тег выгрузки (EVEN — с TYPE по названию вида).

export const EVENT_FIELDS = ['kind', 'date', 'place', 'title', 'body', 'unit', 'rank'];

export const EVENT_KINDS = {
  study: { label: 'Учёба', title: 'Где учился', hint: 'например: Калининский педагогический институт', gedcom: 'EDUC' },
  army: { label: 'Служба в армии', title: 'Где служил', hint: 'например: Прибалтийский военный округ', military: true, gedcom: '_MILT' },
  war: { label: 'Война', title: 'Какая война, фронт', hint: 'например: Великая Отечественная, Калининский фронт', military: true, gedcom: '_MILT' },
  work: { label: 'Работа', title: 'Где и кем', hint: 'например: завод «Пролетарка», токарь', gedcom: 'OCCU' },
  move: { label: 'Переезд', place: 'Куда', title: 'Откуда', hint: 'например: из д. Горки', gedcom: 'RESI' },
  award: { label: 'Награда', title: 'Название награды', hint: 'например: медаль «За отвагу»', main: true, gedcom: 'EVEN' },
  other: { label: 'Другое', title: 'Что произошло', hint: 'например: построили дом', main: true, gedcom: 'EVEN' },
};
export const EVENT_KIND_KEYS = Object.keys(EVENT_KINDS);

// Название события для ленты и журнала: своё или по виду.
export const eventTitle = (e) => (e?.kind === 'other' && e.title) || EVENT_KINDS[e?.kind]?.label || 'Событие';
