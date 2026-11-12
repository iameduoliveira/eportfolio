/* Talks & writing page: featured items, headline numbers, map of places and the filterable list. */
(function () {
  const { esc, load, fail, plural, delegate } = window.EO;
  const $ = (id) => document.getElementById(id);
  const KINDS = ['Keynote or invited talk', 'Workshop', 'University seminar', 'Writing', 'In the media'];
  const CHIP = { 'Keynote or invited talk': 'Keynotes & invited talks', 'Workshop': 'Workshops', 'University seminar': 'University seminars', 'Writing': 'Writing', 'In the media': 'In the media' };
  const BADGE = { 'Keynote or invited talk': 'background:var(--navy);color:#fff', 'Workshop': 'background:var(--navy-soft);color:var(--navy)', 'University seminar': 'background:#F1F3F6;color:var(--ink)', 'Writing': 'background:#E7F6EF;color:#0B5D3B', 'In the media': 'background:var(--award-bg);color:var(--award-fg)' };
  const SPOKEN = { 'Keynote or invited talk': 1, 'Workshop': 1, 'University seminar': 1 };
  const S = { kind: 'all', place: null, hover: null };
  let K, W;

  /* Natural Earth projection, fitted to the 800 x 400 world map in data/world.json */
  function project(lat, lon) {
    const l = lon * Math.PI / 180, p = lat * Math.PI / 180, p2 = p * p, p4 = p2 * p2;
    const x = l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
    const y = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
    return [400 + 146.5303 * x, 229.7164 - 146.5303 * y];
  }

  Promise.all([load('talks'), load('world')]).then(([k, w]) => {
    K = k; W = w; K.items = K.items.map((x, i) => Object.assign({ i }, x));
    $('featured').innerHTML = (K.featured || []).map((f) => `<div class="feature"><p class="k">${esc(f.kicker)}</p><h3 style="margin:0 0 .5rem;font-size:1.25rem">${esc(f.title)}</h3><p class="muted" style="margin:0 0 .9rem;font-size:.92rem">${esc(f.text)}</p><a href="${esc(f.url)}" style="font-weight:600;font-size:.92rem">${esc(f.link_text)} →</a></div>`).join('');
    const spoken = K.items.filter((x) => SPOKEN[x.type]);
    const countries = new Set(spoken.filter((x) => x.place && K.places[x.place]).map((x) => K.places[x.place].name.split(', ').pop().replace(/^(Melbourne|Brisbane)$/, 'Australia')));
    $('kpis').innerHTML = [[K.items.filter((x) => x.type === 'Keynote or invited talk').length, 'keynotes and invited talks'], [K.items.filter((x) => x.type === 'Workshop').length, 'international workshops'],
      [K.items.filter((x) => x.type === 'University seminar').length, 'university seminars'], [countries.size, 'countries'], [K.items.filter((x) => x.type === 'Writing' || x.type === 'In the media').length, 'articles, chapters and features']]
      .map(([v, l]) => `<div><div class="stat-v">${esc(v)}</div><div class="stat-l">${esc(l)}</div></div>`).join('');
    wire(); render();
  }).catch((e) => fail($('kpis'), e));

  function counts() { const c = {}; K.items.filter((x) => SPOKEN[x.type] && x.place).forEach((x) => { c[x.place] = (c[x.place] || 0) + 1; }); return c; }
  function render() {
    if (!K) return;
    const pc = counts(), NAVY = window.EO.css('--navy'), INK = window.EO.css('--ink');
    const land = W.map((m) => `<path d="${m.d}" fill="#E9EDF2" stroke="#fff" stroke-width="0.5"/>`).join('');
    const marks = Object.entries(K.places).filter(([k]) => pc[k]).map(([k, p]) => { const [x, y] = project(p.lat, p.lon), on = S.place === k, hov = S.hover === k;
      return `<circle data-place="${esc(k)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(5 + Math.sqrt(pc[k]) * 3.5).toFixed(1)}" fill="${on ? '#eb6834' : NAVY}" fill-opacity="0.85" stroke="${on || hov ? INK : '#fff'}" stroke-width="${on || hov ? 2.5 : 1.5}" style="cursor:pointer"/>`; }).join('');
    $('map').innerHTML = land + marks;
    $('places').innerHTML = Object.keys(K.places).filter((k) => pc[k]).sort((a, b) => pc[b] - pc[a]).map((k) =>
      `<li><button type="button" class="person" data-act="place" data-place="${esc(k)}" aria-pressed="${S.place === k}"><span>${esc(K.places[k].name)}</span><span class="muted">${plural(pc[k], 'event')}</span></button></li>`).join('');
    const byPlace = K.items.filter((x) => !S.place || x.place === S.place), F = byPlace.filter((x) => S.kind === 'all' || x.type === S.kind);
    $('type-chips').innerHTML = [['all', 'All', byPlace.length]].concat(KINDS.map((k) => [k, CHIP[k], byPlace.filter((x) => x.type === k).length]))
      .map(([k, l, n]) => `<button type="button" class="chip" data-act="kind" data-k="${esc(k)}" aria-pressed="${S.kind === k}">${esc(l)} <span class="n">${n}</span></button>`).join('') +
      (S.place ? `<button type="button" class="pill" data-act="clear-place">Place: ${esc(K.places[S.place].name)} ×</button>` : '');
    $('list-summary').textContent = `${plural(F.length, 'item')}, newest first`;
    const groups = []; F.slice().sort((a, b) => (b.year || 0) - (a.year || 0)).forEach((x) => { const y = x.year ? String(x.year) : 'Other'; let g = groups[groups.length - 1]; if (!g || g.y !== y) { g = { y, items: [] }; groups.push(g); } g.items.push(x); });
    $('talk-list').innerHTML = groups.length ? groups.map((g) => `<div class="year-group"><span class="year">${esc(g.y)}</span><ul>${g.items.map((x) =>
      `<li><span class="badges" style="margin:0 0 .25rem;font-size:.78rem"><span class="badge" style="border:none;font-weight:700;${BADGE[x.type]}">${esc(x.label)}</span><span class="muted">${esc(x.month ? x.month + ' ' + x.year : x.year || '')}</span></span>
        ${x.url ? `<a href="${esc(x.url)}" style="display:block;font-weight:600;font-size:1.02rem;line-height:1.4">${esc(x.title)}</a>` : `<span style="display:block;font-weight:600;font-size:1.02rem;line-height:1.4">${esc(x.title)}</span>`}
        <span class="paper-meta" style="display:block">${esc(x.where)}</span>
        ${x.parts ? `<ul style="margin:.4rem 0 0;padding-left:1.1em;font-size:.88rem;display:flex;flex-direction:column;gap:.25rem">${x.parts.map((p) => `<li><a href="${esc(p.url)}">${esc(p.title)}</a></li>`).join('')}</ul>` : ''}</li>`).join('')}</ul></div>`).join('') : '<p class="empty">Nothing matches these filters.</p>';
  }
  function wire() {
    const setPlace = (k) => { S.place = S.place === k ? null : k; render(); };
    delegate($('main'), 'click', {
      kind: (el) => { S.kind = el.dataset.k; render(); const b = $('type-chips').querySelector(`[data-k="${CSS.escape(S.kind)}"]`); if (b) b.focus(); },
      place: (el) => { setPlace(el.dataset.place); const b = $('places').querySelector(`[data-place="${CSS.escape(el.dataset.place)}"]`); if (b) b.focus(); },
      'clear-place': () => { S.place = null; render(); },
    });
    $('map').addEventListener('click', (e) => { const c = e.target.closest('[data-place]'); if (c) setPlace(c.dataset.place); });
    const hover = (e) => { const c = e.target.closest('[data-place]'), k = c ? c.dataset.place : null;
      if (k !== S.hover) { S.hover = k; const pc = counts(); $('map-readout').textContent = k ? `${K.places[k].name}: ${plural(pc[k] || 0, 'talk or workshop', 'talks and workshops')}` : 'Hover over or select a place.'; render(); } };
    $('map').addEventListener('mousemove', hover); $('places').addEventListener('mouseover', hover);
    $('map').addEventListener('mouseleave', hover); $('places').addEventListener('mouseleave', hover);
    document.addEventListener('eo:display', render);
  }
})();
