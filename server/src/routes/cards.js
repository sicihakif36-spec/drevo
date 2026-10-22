// Печать на A4: карточка человека и пустой бланк анкеты.
import { need } from '../auth.js';
import { cardData, parseCardOptions } from '../card.js';
import { disposition } from '../pdf.js';
import { renderInWorker, sendPdf } from '../pdfpool.js';
import { fullName } from '../../../shared/names.js';

export default async function cardRoutes(app) {
  // Кто видит карточку, тот может её напечатать; гостю — то же, что в карточке.
  app.get('/api/persons/:id/card.pdf', { preHandler: need('viewer') }, async (req, reply) => {
    const data = await cardData(req.user, req.params.id);
    return sendPdf(reply, renderInWorker('card', data, parseCardOptions(req.query)), disposition(req.query.download === '1', fullName(data.person)));
  });

  // Пустой бланк — тем, кто создаёт анкеты. name — кого опрашиваем, необязательно.
  app.get('/api/survey-blank.pdf', { preHandler: need('editor') }, async (req, reply) => {
    const name = String(req.query.name ?? '').trim().slice(0, 80);
    return sendPdf(reply, renderInWorker('blank', null, { name }), disposition(req.query.download === '1', name ? `Анкета — ${name}` : 'Анкета о семье'));
  });
}
