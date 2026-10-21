// Записи голоса — в MP3: запись с Android (Opus в WebM или MP4) и голосовые из мессенджеров (OGG/Opus)
// не играют на iPhone до iOS 17.4, а MP3 играет везде. Переводит ffmpeg — программа на самом сервере, в сеть не ходит.
// Запуск без оболочки, только по нашему файлу (-protocol_whitelist file) и только известными разборщиками форматов:
// плейлист или «склейка» не заставят ffmpeg читать чужие файлы или ходить по ссылкам.
import { execFile } from 'node:child_process';
import { HttpError } from './tree.js';

const FORMATS = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,ogg,mp3,wav,aac';
const TIMEOUT = 5 * 60 * 1000;
const MAX_SEC = 3 * 3600; // длиннее не переводим: запись в 20 МБ при низком качестве может идти часами

// Перевести input в MP3 (моно, 64 кбит/с — для голоса достаточно) и записать в output.
// Возвращает длительность в секундах, как её насчитал ffmpeg. Непонятный файл — HttpError 400.
export function toMp3(input, output) {
  const args = [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-protocol_whitelist', 'file', '-format_whitelist', FORMATS,
    '-i', `file:${input}`,
    '-map', '0:a:0', '-vn', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', '-t', String(MAX_SEC),
    '-progress', 'pipe:1', '-nostats', '-f', 'mp3', '-y', `file:${output}`,
  ];
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: TIMEOUT, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err?.code === 'ENOENT') return reject(new Error('На сервере не установлен ffmpeg'));
      // -progress пишет ход перевода; в последней строке out_time_us — сколько секунд записи получилось.
      const us = Number([...String(stdout).matchAll(/^out_time_us=(\d+)$/gm)].at(-1)?.[1]);
      if (err || !(us > 0)) return reject(new HttpError(400, 'Не удалось прочитать запись'));
      resolve(Math.max(1, Math.round(us / 1e6)));
    });
  });
}
