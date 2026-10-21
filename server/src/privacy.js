// Гости (только просмотр) видят у живых родственников лишь имена: без дат, мест, заметок и фото.
import { isPrivate } from '../../shared/names.js';

const HIDDEN = {
  birth_surname: '', birth_date: '', birth_place: '', death_date: '', death_place: '', burial_place: '',
  occupation: '', notes: '', photo_id: null, hidden: true,
};

export const isGuest = (user) => user?.role === 'viewer';

export function hideLiving(data) {
  const hidden = new Set(data.persons.filter((p) => isPrivate(p)).map((p) => p.id));
  return {
    ...data,
    persons: data.persons.map((p) => (hidden.has(p.id) ? { ...p, ...HIDDEN } : p)),
    families: data.families.map((f) => (hidden.has(f.partner1) || hidden.has(f.partner2) ? { ...f, start_date: '', end_date: '' } : f)),
  };
}
