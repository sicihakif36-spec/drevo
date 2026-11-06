export class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

// headers — дополнительные заголовки (анкета по ссылке передаёт свой токен в x-survey).
export async function api(method, url, body, headers = {}) {
  const opts = { method, headers: { 'x-drevo': '1', ...headers }, credentials: 'same-origin' };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет.');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || `Ошибка ${res.status}`, data);
  return data;
}

export const photoUrl = (id) => (id ? `/api/media/${id}` : null);
export const thumbUrl = (id) => `/api/media/${id}/thumb`;

// Отправка файла с ходом загрузки: onProgress(доля от 0 до 1). fetch хода отправки не сообщает.
export function upload(url, form, onProgress, headers = {}) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('x-drevo', '1');
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.responseType = 'json';
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) resolve(x.response);
      else reject(new ApiError(x.status, x.response?.error || (x.status === 413 ? 'Файл слишком большой' : `Ошибка ${x.status}`), x.response));
    };
    x.onerror = () => reject(new ApiError(0, 'Нет связи с сервером. Проверьте интернет.'));
    x.send(form);
  });
}

// Уменьшить снимок на телефоне перед отправкой: быстрее и меньше места на сервере.
// sizes — [[наибольшая сторона, качество], …]: фото 1280, скан документа 2400 (чтобы читался текст), миниатюра 400.
// null — браузер не смог прочитать снимок (тогда файл уходит как есть).
export async function shrinkImage(file, sizes) {
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return null;
  const out = [];
  for (const [max, quality] of sizes) {
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * k);
    canvas.height = Math.round(img.height * k);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    out.push(await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality)));
  }
  img.close();
  return out.every(Boolean) ? out : null;
}

// Один файл в альбом человека: снимок уменьшается на телефоне (скан документа — крупнее, чтобы читался текст),
// PDF уходит как есть. caption — подпись (название документа), batch — продолжение того же выбора файлов.
export const MAX_FILE = 20 * 1024 * 1024; // как на сервере
export async function uploadMedia(personId, file, { kind = 'doc', caption = '', batch = '', onProgress } = {}) {
  const pdf = file.type === 'application/pdf';
  const img = pdf ? null : await shrinkImage(file, [[kind === 'doc' ? 2400 : 1280, 0.86], [400, 0.8]]);
  if (!img && file.size > MAX_FILE) throw new Error('файл больше 20 МБ');
  const fd = new FormData();
  fd.append('kind', kind);
  if (batch) fd.append('batch', batch);
  if (caption) fd.append('caption', caption);
  fd.append('file', img ? img[0] : file, img ? file.name.replace(/\.[^.]*$/, '') + '.jpg' : file.name);
  if (img) fd.append('thumb', img[1], 'thumb.jpg');
  return upload(`/api/persons/${personId}/media`, fd, onProgress);
}
