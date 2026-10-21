// Поколенная роспись: PDF (собирается в потоке pdfpool.js) и события с источниками для предпросмотра на экране —
// сама роспись на экране собирается тем же shared/rospis.js из дерева телефона.
import { need } from '../auth.js';
import { HttpError } from '../tree.js';
import { isGuest } from '../privacy.js';
import { loadTreeData } from './print.js';
import { rospisExtras } from '../rospis.js';
import { disposition } from '../pdf.js';
import { renderInWorker, sendPdf } from '../pdfpool.js';
import { parseRospisOptions } from '../../../shared/rospis.js';
import { fullName } from '../../../shared/names.js';

// Гостю живые — всегда только именем; владельцу — по галочке «скрыть даты и фото живых».
function options(req) {
  const o = parseRospisOptions(req.query);
  o.hideLiving = o.hideLiving || isGuest(req.user);
  if (!o.root) o.root = req.user.person_id || '';
  return o;
}

export default async function rospisRoutes(app) {
  app.get('/api/rospis.pdf', { preHandler: need('viewer') }, async (req, reply) => {
    const o = options(req);
    const tree = await loadTreeData(req.user, o.hideLiving);
    const root = tree.persons.find((p) => p.id === o.root);
    if (!root) throw new HttpError(404, 'Родоначальник не найден: выберите человека из дерева');
    const extras = await rospisExtras(req.user, o.hideLiving, o);
    const name = `Поколенная роспись — ${fullName(root)}${o.line === 'male' ? ' (по мужской линии)' : ''}`;
    return sendPdf(reply, renderInWorker('rospis', { ...tree, ...extras }, o), disposition(req.query.download === '1', name));
  });

  app.get('/api/rospis/extras', { preHandler: need('viewer') }, async (req) => {
    const o = options(req);
    return rospisExtras(req.user, o.hideLiving, o);
  });
}
