// Пароли владельца и участников: scrypt со своей солью у каждого, сравнение за постоянное время.
// В базе — строка «scrypt$N$r$p$соль$ключ», сам пароль нигде не хранится.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { passwordProblem } from '../../shared/password.js';
import { HttpError } from './tree.js';

const scrypt = promisify(crypto.scrypt);
const N = 16384;
const R = 8;
const P = 1;
const LEN = 32;

export async function hashPassword(password) {
  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, problem);
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password).normalize('NFC'), salt, LEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function checkPassword(password, stored) {
  const [kind, n, r, p, salt, key] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !key || typeof password !== 'string' || password.length > 1000) return false;
  const want = Buffer.from(key, 'base64');
  const got = await scrypt(password.normalize('NFC'), Buffer.from(salt, 'base64'), want.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(got, want);
}
