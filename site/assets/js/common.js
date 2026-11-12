/* Shared by every page: text-size and contrast buttons, data loading and small helpers. */
(function () {
  const root = document.documentElement;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: settings last for this visit only */ } }
  };
  let size = Number(store.get('eo-size') || 1);
  if (!(size >= 0 && size <= 3)) size = 1;
  const apply = () => {
    root.setAttribute('data-size', String(size));
    const hc = store.get('eo-contrast') === '1';
    root.classList.toggle('hc', hc);
    const b = document.getElementById('a-contrast');
    if (b) b.setAttribute('aria-pressed', hc ? 'true' : 'false');
    document.dispatchEvent(new CustomEvent('eo:display'));
  };
  document.addEventListener('DOMContentLoaded', () => {
    const minus = document.getElementById('a-minus'), plus = document.getElementById('a-plus'), con = document.getElementById('a-contrast');
    if (minus) minus.addEventListener('click', () => { size = Math.max(0, size - 1); store.set('eo-size', size); apply(); });
    if (plus) plus.addEventListener('click', () => { size = Math.min(3, size + 1); store.set('eo-size', size); apply(); });
    if (con) con.addEventListener('click', () => { store.set('eo-contrast', root.classList.contains('hc') ? '0' : '1'); apply(); });
    apply();
  });
  root.setAttribute('data-size', String(size));
  if (store.get('eo-contrast') === '1') root.classList.add('hc');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const css = (name) => getComputedStyle(root).getPropertyValue(name).trim();
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const load = (name) => fetch('data/' + name + '.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(name + ': ' + r.status); return r.json(); });
  const fail = (el, e) => { if (el) el.innerHTML = '<p class="empty">This section could not load its data. Please refresh the page.</p>'; console.error(e); };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  /* Bold every author name that is Eduardo's, keep the rest muted. */
  const authors = (s) => String(s || '').split(/,\s*/).map((n, i, a) => {
    const t = esc(n) + (i < a.length - 1 ? ', ' : '');
    return /oliveira/i.test(n) ? '<span class="me">' + t + '</span>' : t;
  }).join('');
  /* Event delegation: data-act="name" on any element calls handlers[name](el, event). */
  const delegate = (rootEl, type, handlers) => rootEl.addEventListener(type, (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !rootEl.contains(el)) return;
    const fn = handlers[el.getAttribute('data-act')];
    if (fn) fn(el, e);
  });
  window.EO = { esc, css, reduceMotion, load, fail, plural, authors, delegate, store };
})();
