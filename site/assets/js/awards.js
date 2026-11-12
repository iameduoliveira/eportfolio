/* Awards page: type and level filters, headline numbers, recognition strip and the list. */
(function () {
  const { esc, load, fail, plural, delegate } = window.EO;
  const $ = (id) => document.getElementById(id);
  const LEVELS = ['International', 'National', 'University', 'Faculty', 'School'];
  const S = { type: 'all', level: 'all', sel: null };
  let A;
  const ICON = {
    Research: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="6"/><path d="M8.2 13.2 7 22l5-3 5 3-1.2-8.8"/></svg>',
    Teaching: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/></svg>' };

  load('awards').then((d) => {
    A = d.awards.map((a, i) => Object.assign({ i }, a)).sort((a, b) => b.year - a.year);
    $('f-level').innerHTML = '<option value="all">All levels</option>' + LEVELS.map((l) => `<option value="${l}">${l} (${A.filter((a) => a.level === l).length})</option>`).join('');
    wire(); render();
  }).catch((e) => fail($('kpis'), e));

  function render() {
    if (!A) return;
    const byLevel = A.filter((a) => S.level === 'all' || a.level === S.level);
    const F = byLevel.filter((a) => S.type === 'all' || a.type === S.type), inF = new Set(F.map((a) => a.i));
    $('type-chips').innerHTML = [['all', 'All'], ['Research', 'Research'], ['Teaching', 'Teaching']].map(([k, l]) =>
      `<button type="button" class="chip" data-act="type" data-k="${k}" aria-pressed="${S.type === k}">${l} <span class="n">${k === 'all' ? byLevel.length : byLevel.filter((a) => a.type === k).length}</span></button>`).join('');
    const ys = F.map((a) => a.year);
    $('kpis').innerHTML = [[F.length, F.length === 1 ? 'award or recognition' : 'awards and recognitions'], [F.filter((a) => /best (student )?paper|best concise paper/i.test(a.title)).length, 'best paper awards'],
      [F.filter((a) => a.type === 'Teaching').length, 'for teaching'], [F.filter((a) => a.level === 'International').length, 'international'],
      [ys.length ? Math.min(...ys) + '–' + String(Math.max(...ys)).slice(2) : '–', 'years covered']]
      .map(([v, l]) => `<div><div class="stat-v">${esc(v)}</div><div class="stat-l">${esc(l)}</div></div>`).join('');
    const y0 = Math.min(...A.map((a) => a.year)), y1 = Math.max(new Date().getFullYear(), ...A.map((a) => a.year)), cols = [];
    for (let y = y0; y <= y1; y++) {
      const marks = A.filter((a) => a.year === y).map((a) => { const on = S.sel === a.i, st = on ? 'var(--ink)' : '#fff', sw = on ? 2.5 : 1.5;
        const shape = a.type === 'Research' ? `<circle cx="10" cy="10" r="8" fill="${window.EO.css('--navy')}" stroke="${on ? window.EO.css('--ink') : '#fff'}" stroke-width="${sw}"/>`
          : `<rect x="4" y="4" width="12" height="12" transform="rotate(45 10 10)" fill="${window.EO.css('--orange')}" stroke="${on ? window.EO.css('--ink') : '#fff'}" stroke-width="${sw}"/>`;
        return `<button type="button" class="mark" data-act="mark" data-i="${a.i}" data-lab="${esc(a.year + ' · ' + a.title + ' · ' + a.by)}" aria-label="${esc(a.year + ': ' + a.title + ', ' + a.by)}" aria-pressed="${on}" style="opacity:${inF.has(a.i) ? 1 : 0.2}"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">${shape}</svg></button>`; }).join('');
      cols.push([y, marks]);
    }
    $('strip').innerHTML = cols.map(([, m]) => `<div>${m}</div>`).join('');
    $('strip-axis').innerHTML = cols.map(([y]) => `<span>${y % 2 === 1 || y === y1 ? "'" + String(y).slice(2) : ''}</span>`).join('');
    $('list-summary').textContent = `${plural(F.length, 'award')}, newest first`;
    const groups = []; F.forEach((a) => { let g = groups[groups.length - 1]; if (!g || g.y !== a.year) { g = { y: a.year, items: [] }; groups.push(g); } g.items.push(a); });
    $('award-list').innerHTML = groups.length ? groups.map((g) => `<div class="year-group"><span class="year">${g.y}</span><ul>${g.items.map((a) =>
      `<li style="display:flex;gap:.9rem;padding:.6rem .7rem;margin:-.6rem -.7rem;border-radius:10px;background:${S.sel === a.i ? 'var(--hover)' : 'transparent'}">
        <span class="icon" style="background:${a.type === 'Research' ? 'var(--navy-soft)' : 'var(--teach-bg)'};color:${a.type === 'Research' ? 'var(--navy)' : 'var(--teach-fg)'}">${ICON[a.type]}</span>
        <span style="flex:1 1 auto;min-width:0"><span style="display:block;font-weight:600;font-size:1.05rem;line-height:1.35">${esc(a.title)}</span>
          <span class="paper-meta" style="display:block">${esc(a.by)}</span>
          ${a.description ? `<span style="display:block;font-size:.92rem;margin-top:.3rem">${esc(a.description)}</span>` : ''}
          ${a.with ? `<span class="small muted" style="display:block;margin-top:.2rem">With ${esc(a.with)}</span>` : ''}
          <span class="badges"><span class="badge badge-rank">${esc(a.level)}</span><span class="badge">${esc(a.type)}</span>${(a.related || []).filter((r) => r.url).map((r) => `<a href="${esc(r.url)}" style="display:inline-flex;align-items:center;min-height:28px;padding:0 .4rem;font-weight:500">${esc(r.label)} →</a>`).join('')}</span>
        </span></li>`).join('')}</ul></div>`).join('') : '<p class="empty">No awards match these filters.</p>';
  }
  function wire() {
    delegate($('main'), 'click', {
      type: (el) => { S.type = el.dataset.k; S.sel = null; render(); const b = $('type-chips').querySelector(`[data-k="${el.dataset.k}"]`); if (b) b.focus(); },
      mark: (el) => { const i = +el.dataset.i; S.sel = S.sel === i ? null : i; render(); const b = $('strip').querySelector(`[data-i="${i}"]`); if (b) b.focus(); },
    });
    const ro = (e) => { const b = e.target.closest('[data-lab]'); $('strip-readout').textContent = b ? b.dataset.lab : 'Hover over or select a mark to see the award.'; };
    $('strip').addEventListener('mouseover', ro); $('strip').addEventListener('focusin', ro);
    $('f-level').addEventListener('change', (e) => { S.level = e.target.value; S.sel = null; render(); });
    document.addEventListener('eo:display', render);
  }
})();
