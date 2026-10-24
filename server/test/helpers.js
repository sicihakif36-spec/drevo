// Общие помощники тестов.
import assert from 'node:assert/strict';
import { createInvite } from '../src/auth.js';

export const H = { 'x-drevo': '1' };
// Пароль, который придумывают владелец и участники в тестах.
export const PASSWORD = 'проверка-входа';
export const cookieOf = (r) => r.cookies.filter((c) => c.value).map((c) => `${c.name}=${c.value}`).join('; ');

// Вход по новой ссылке-приглашению с ролью role; владелец и участник сразу придумывают пароль, как на телефоне.
// Возвращает cookie для app.inject. label, name — как в приглашении и в поле «Как вас зовут».
export async function signIn(app, role, { label = '', name = '', password = PASSWORD } = {}) {
  const { token } = await createInvite({ role, label });
  const r = await app.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token, name } });
  assert.equal(r.statusCode, 200, r.body);
  const cookie = cookieOf(r);
  if (['owner', 'editor'].includes(role) && password) {
    const p = await app.inject({ method: 'POST', url: '/api/me/password', headers: { ...H, cookie }, payload: { password } });
    assert.equal(p.statusCode, 200, p.body);
  }
  return cookie;
}
