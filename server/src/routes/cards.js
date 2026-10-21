// Печать на A4: карточка человека и пустой бланк анкеты.
import { PassThrough } from 'node:stream';
import { need } from '../auth.js';
import { cardData, parseCardOptions, renderCard } from '../card.js';
import { renderBlank } from '../blank.js';
import { disposition } from '../pdf.js';
import { fullName } from '../../../shared/names.js';

function sendPdf(reply, req, name, render) {
  reply.header('Content-Type', 'application/pdf');
  reply.header('Content-Disposition', disposition(req.query.download === '1', name));
  reply.header('Cache-Control', 'no-store');
  const out = new PassThrough();
  render(out);
  return reply.send(out);
}

export default async function cardRoutes(app) {
  // Кто видит карточку, тот может её напечатать; гостю — то же, что в карточке.
  app.get('/api/persons/:id/card.pdf', { preHandler: need('viewer') }, async (req, reply) => {
    const data = await cardData(req.user, req.params.id);
    return sendPdf(reply, req, fullName(data.person), (out) => renderCard(out, data, parseCardOptions(req.query)));
  });

  // Пустой бланк — тем, кто создаёт анкеты. name — кого опрашиваем, необязательно.
  app.get('/api/survey-blank.pdf', { preHandler: need('editor') }, async (req, reply) => {
    const name = String(req.query.name ?? '').trim().slice(0, 80);
    return sendPdf(reply, req, name ? `Анкета — ${name}` : 'Анкета о семье', (out) => renderBlank(out, { name }));
  });
}
