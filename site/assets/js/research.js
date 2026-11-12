/* Research page: theme filter, charts, co-author network, topics, research over time and the publication list. */
(function () {
  const { esc, load, fail, plural, authors, delegate, reduceMotion } = window.EO;
  const $ = (id) => document.getElementById(id);
  const TYPES = [['Journal', 'var(--navy)', 'j'], ['Conference', 'var(--orange)', 'c'], ['Book chapter', 'var(--green)', 'b'], ['Preprint & other', 'var(--yellow)', 'p']];
  const RANKED = { 'CORE A*': 1, 'CORE A': 1, 'CORE B': 1, 'Q1': 1, 'Q2': 1 };
  const NOW = new Date().getFullYear();
  const PERIODS = ['≤2015', '2016–19'].concat(Array.from({ length: NOW - 2019 }, (_, i) => String(2020 + i)));
  const per = (y) => (!y ? null : y <= 2015 ? '≤2015' : y <= 2019 ? '2016–19' : String(y));
  const params = new URLSearchParams(location.search);
  const S = { theme: params.get('theme') || 'all', table: false, sel: null, hoverNode: null, upto: null, playing: false,
    topic: null, cell: null, q: '', fType: 'all', fYear: 'all', sort: 'new', ranked: false, awarded: false, limit: 20, open: null, copied: null };
  let D, F, byId = {};

  /* keep keyboard focus on the same control after a section is redrawn */
  function redraw(el, html) {
    const a = document.activeElement, key = a && el.contains(a) ? a.getAttribute('data-focus') : null;
    el.innerHTML = html;
    if (key) { const b = el.querySelector(`[data-focus="${CSS.escape(key)}"]`); if (b) b.focus(); }
  }
  const themeName = () => (S.theme === 'all' ? 'All research' : (D.themes.find((t) => t[0] === S.theme) || ['', ''])[1]);
  const inTheme = (w) => S.theme === 'all' || w.th.indexOf(S.theme) >= 0;

  load('research').then((data) => {
    D = data;
    if (!D.themes.some((t) => t[0] === S.theme)) S.theme = 'all';
    D.nodes.forEach((n) => { byId[n.id] = n; });
    $('net-intro').textContent = `The ${D.nodes.length - 1} people I have written two or more papers with. Circle size shows papers together; lines join people who have written together. Drag people around, hover for names, select someone to see our shared papers, or press Play to watch the network grow.`;
    $('type-legend').innerHTML = TYPES.map((t) => `<span><span class="sw" style="background:${t[1]}"></span>${esc(t[0])}</span>`).join('');
    const yrs = [...new Set(D.works.map((w) => w.y).filter((y) => y >= 2020))].sort((a, b) => b - a);
    $('f-year').innerHTML = '<option value="all">All years</option>' + yrs.map((y) => `<option>${y}</option>`).join('') + '<option value="before2020">Before 2020</option>';
    $('research-note').textContent = `About these numbers: every paper and citation count comes from Google Scholar (${D.headline.works} papers, ${D.headline.citations} citations). Paper type, venue rank and co-authors come from OpenAlex where the paper is indexed there; otherwise they are read from Google Scholar. Themes are assigned by keywords in each paper's title (with my own corrections), so a paper can belong to more than one. Updated monthly.`;
    wire();
    initNetwork();
    renderAll();
  }).catch((e) => fail($('kpis'), e));

  function renderAll() {
    F = D.works.filter(inTheme);
    renderChips(); renderKpis(); renderPubs(); renderCites(); renderPeople(); renderSel(); renderInsts(); renderCloud(); renderGrid(); renderList(); drawNetwork();
  }

  /* ---------- theme chips and headline numbers ---------- */
  function renderChips() {
    const chips = [['all', 'All', D.works.length]].concat(D.themes.map((t) => [t[0], t[1], D.works.filter((w) => w.th.indexOf(t[0]) >= 0).length]));
    redraw($('theme-chips'), chips.map(([k, l, n]) => `<button type="button" class="chip" data-act="theme" data-k="${esc(k)}" data-focus="theme-${esc(k)}" aria-pressed="${S.theme === k}">${esc(l)} <span class="n">${n}</span></button>`).join(''));
  }
  function renderKpis() {
    const cites = F.map((w) => w.c || 0).sort((a, b) => b - a);
    let h = 0; cites.forEach((c, i) => { if (c >= i + 1) h = i + 1; });
    const H = D.headline, venues = new Set(F.map((w) => w.v).filter(Boolean));
    const k = S.theme === 'all'
      ? [[H.works, 'publications'], [H.citations, 'citations'], [H.h, 'h-index'], [H.i10, 'i10-index'], [H.coauthors, 'co-authors']]
      : [[F.length, 'papers in this theme'], [cites.reduce((a, b) => a + b, 0), 'citations to these papers'], [h, 'h-index for this theme'], [venues.size, 'venues']];
    $('kpis').innerHTML = k.map(([v, l]) => `<div><div class="stat-v">${esc(v)}</div><div class="stat-l">${esc(l)}</div></div>`).join('');
    $('kpi-note').textContent = S.theme === 'all' ? 'All years. Google Scholar.' : 'All years, papers in this theme. Google Scholar citation counts.';
  }

  /* ---------- publications per year (stacked by type) ---------- */
  function perYear() {
    const out = {};
    for (let y = 2020; y <= NOW; y++) out[y] = { j: 0, c: 0, b: 0, p: 0 };
    F.forEach((w) => { const t = TYPES.find((x) => x[0] === w.k); if (out[w.y] && t) out[w.y][t[2]]++; });
    return out;
  }
  const tot = (o) => o.j + o.c + o.b + o.p;
  function renderPubs() {
    const P = perYear(), years = Object.keys(P);
    $('table-toggle').textContent = S.table ? 'Show chart' : 'Show as table';
    $('table-toggle').setAttribute('aria-pressed', S.table);
    if (S.table) {
      $('pubs-chart').innerHTML = `<div style="max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:8px"><table class="data"><thead><tr><th scope="col">Year</th><th scope="col">Journal</th><th scope="col">Conference</th><th scope="col">Chapter</th><th scope="col">Preprint &amp; other</th><th scope="col">Total</th></tr></thead><tbody>` +
        years.slice().reverse().map((y) => { const o = P[y]; return `<tr><th scope="row">${y}</th><td>${o.j}</td><td>${o.c}</td><td>${o.b}</td><td>${o.p}</td><td><strong>${tot(o)}</strong></td></tr>`; }).join('') + '</tbody></table></div>';
      return;
    }
    const yMax = Math.max(4, Math.ceil(Math.max(1, ...years.map((y) => tot(P[y]))) / 2) * 2);
    $('pubs-chart').innerHTML = `<div class="bars" aria-hidden="true"><div class="gl" style="top:0"></div><div class="gl" style="top:50%"></div><span class="ymax">${yMax} papers</span>` +
      years.map((y) => { const o = P[y], segs = TYPES.filter((t) => o[t[2]] > 0);
        return `<div class="bar" data-y="${y}">` + segs.map((t, i) => `<span style="height:${Math.max(3, o[t[2]] / yMax * 176 - 2)}px;background:${t[1]};border-radius:${i === segs.length - 1 ? '4px 4px 0 0' : '0'}"></span>`).join('') + '</div>'; }).join('') +
      `</div><div class="axis-x" aria-hidden="true">${years.map((y) => `<span>${y}</span>`).join('')}</div>`;
    $('pubs-readout').textContent = 'Hover over a year to see its papers. Use "Show as table" for the numbers.';
  }
  function pubsHover(y) {
    $('pubs-chart').querySelectorAll('.bar').forEach((b) => b.classList.toggle('on', b.dataset.y === y));
    if (!y) { $('pubs-readout').textContent = 'Hover over a year to see its papers. Use "Show as table" for the numbers.'; return; }
    const o = perYear()[y];
    $('pubs-readout').textContent = tot(o) ? `${y}: ${plural(tot(o), 'paper')} · ` + TYPES.filter((t) => o[t[2]]).map((t) => o[t[2]] + ' ' + t[0].toLowerCase()).join(', ') : `${y}: no papers`;
  }

  /* ---------- citations per year ---------- */
  function renderCites() {
    const ys = Object.keys(D.cby).filter((y) => +y >= 2020).sort();
    const max = Math.max(1, ...ys.map((y) => D.cby[y]));
    const top = Math.ceil(max / 20) * 20;
    $('cites-chart').innerHTML = `<div class="bars" role="img" aria-label="Citations per year from ${ys[0]} to ${ys[ys.length - 1]}: ${ys.map((y) => y + ' ' + D.cby[y]).join(', ')}"><div class="gl" style="top:0"></div><span class="ymax">${top}</span>` +
      ys.map((y) => `<div class="bar" data-cy="${y}" style="flex-direction:row;align-items:flex-end"><span style="width:100%;height:${Math.max(3, D.cby[y] / top * 180)}px;background:var(${+y === NOW ? '--navy-faint' : '--navy'});border-radius:4px 4px 0 0"></span></div>`).join('') +
      `</div><div class="axis-x" aria-hidden="true">${ys.map((y) => `<span>${y}</span>`).join('')}</div>`;
  }

  /* ---------- co-author network (live force layout) ---------- */
  const P = {}; let alpha = 1, drag = null, dragMoved = false, raf = null, timer = null;
  const rad = (n) => (n.id === 'me' ? 22 : Math.round(5 + Math.sqrt(n.p) * 3.2));
  const visible = (n) => S.upto == null || n.id === 'me' || n.fy <= S.upto;
  const lit = (n) => n.id === 'me' || S.theme === 'all' || n.th.indexOf(S.theme) >= 0;
  function initNetwork() {
    D.nodes.forEach((n, i) => { const a = i * 2.39996, r = n.id === 'me' ? 0 : 90 + (i % 7) * 25; P[n.id] = { x: 400 + Math.cos(a) * r, y: 260 + Math.sin(a) * r * 0.8, vx: 0, vy: 0 }; });
    if (reduceMotion()) { for (let i = 0; i < 400; i++) tick(); alpha = 0; drawNetwork(); } else loop();
  }
  function tick() {
    const vis = D.nodes.filter(visible), V = {};
    vis.forEach((n) => { V[n.id] = 1; });
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const A = P[vis[i].id], B = P[vis[j].id];
      let dx = B.x - A.x, dy = B.y - A.y, d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
      const d = Math.sqrt(d2), min = rad(vis[i]) + rad(vis[j]) + 26;
      let f = 5200 / d2 * alpha; if (d < min) f += (min - d) * 0.5;
      A.vx -= dx / d * f; A.vy -= dy / d * f; B.vx += dx / d * f; B.vy += dy / d * f;
    }
    D.edges.forEach((e) => {
      if (!V[e.a] || !V[e.b]) return;
      const A = P[e.a], B = P[e.b], dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const me = e.a === 'me' || e.b === 'me', L = me ? 185 - Math.min(45, e.w * 2.5) : 140, k = me ? 0.02 : 0.008 * Math.min(3, e.w);
      const f = (d - L) * k * alpha;
      A.vx += dx / d * f; A.vy += dy / d * f; B.vx -= dx / d * f; B.vy -= dy / d * f;
    });
    vis.forEach((n) => {
      const p = P[n.id];
      if (n.id === 'me' && drag !== 'me') { p.x += (400 - p.x) * 0.1; p.y += (260 - p.y) * 0.1; p.vx = p.vy = 0; return; }
      if (drag === n.id) { p.vx = p.vy = 0; return; }
      p.vx += (400 - p.x) * 0.001 * alpha; p.vy += (260 - p.y) * 0.0015 * alpha;
      p.vx *= 0.6; p.vy *= 0.6;
      p.x = Math.max(24, Math.min(776, p.x + p.vx)); p.y = Math.max(24, Math.min(496, p.y + p.vy));
    });
    alpha = Math.max(drag ? 0.3 : 0, alpha * 0.985);
  }
  function loop() {
    const step = () => { if (alpha > 0.01 || drag) { tick(); drawNetwork(); } raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  }
  function reheat(v) { alpha = Math.max(alpha, v); if (reduceMotion()) { for (let i = 0; i < 300 && alpha > 0.01; i++) tick(); drawNetwork(); } }
  function drawNetwork() {
    if (!D) return;
    const f1 = (v) => v.toFixed(1), sel = S.sel, hov = S.hoverNode, NAVY = window.EO.css('--navy') || '#1F4E99', INK = window.EO.css('--ink') || '#16202C';
    const edges = D.edges.filter((e) => visible(byId[e.a]) && visible(byId[e.b])).map((e) => {
      const on = lit(byId[e.a]) && lit(byId[e.b]), touch = [sel, hov].some((x) => x && (e.a === x || e.b === x));
      return `<line x1="${f1(P[e.a].x)}" y1="${f1(P[e.a].y)}" x2="${f1(P[e.b].x)}" y2="${f1(P[e.b].y)}" stroke="${touch ? '#eb6834' : '#8FA3BF'}" stroke-width="${Math.min(6, 0.8 + e.w * 0.5)}" stroke-opacity="${on ? (touch ? 0.9 : 0.4) : 0.06}"/>`;
    }).join('');
    const nodes = D.nodes.filter(visible).slice().reverse().map((n) => {
      const isSel = sel === n.id, isHov = hov === n.id;
      return `<circle data-id="${esc(n.id)}" cx="${f1(P[n.id].x)}" cy="${f1(P[n.id].y)}" r="${rad(n) + (isHov ? 2 : 0)}" fill="${n.id === 'me' ? NAVY : isSel ? '#eb6834' : '#6E8FC9'}" fill-opacity="${lit(n) ? 1 : 0.15}" stroke="${isSel || isHov ? INK : '#fff'}" stroke-width="${isSel || isHov ? 3 : 2}" style="cursor:${drag === n.id ? 'grabbing' : 'grab'}"/>`;
    }).join('');
    const short = (s) => s.split(' ')[0] + ' ' + s.split(' ').slice(-1)[0];
    const labels = D.nodes.filter((n) => visible(n) && (n.p >= 9 || n.id === sel || n.id === hov) && n.id !== 'me').map((n) =>
      `<text x="${f1(P[n.id].x)}" y="${f1(n.id === 'me' ? P[n.id].y + 40 : P[n.id].y - rad(n) - 7)}" text-anchor="middle" font-size="13" font-weight="500" fill="${INK}" fill-opacity="${lit(n) ? 1 : 0.3}" style="paint-order:stroke;stroke:#FBFCFE;stroke-width:4px;pointer-events:none">${esc(short(n.n))}</text>`).join('');
    $('net-svg').innerHTML = edges + nodes + labels;
    const tip = $('net-tip'), hn = hov && byId[hov];
    if (hn && visible(hn)) {
      tip.hidden = false; tip.style.left = (P[hn.id].x / 8) + '%'; tip.style.top = ((P[hn.id].y - rad(hn)) / 5.2) + '%';
      tip.textContent = hn.n + (hn.id === 'me' ? '' : ' · ' + plural(hn.p, 'paper') + ' together');
    } else tip.hidden = true;
    $('net-year').textContent = S.upto == null ? '' : 'Up to ' + S.upto;
  }
  function renderPeople() {
    redraw($('people'), D.nodes.filter((n) => n.id !== 'me').map((n) =>
      `<li><button type="button" class="person" data-act="person" data-id="${esc(n.id)}" data-focus="p-${esc(n.id)}" aria-pressed="${S.sel === n.id}" style="opacity:${lit(n) && visible(n) ? 1 : 0.45}"><span>${esc(n.n)}</span><span class="muted" style="font-size:.9em;white-space:nowrap">${plural(n.p, 'paper')}</span></button></li>`).join(''));
  }
  function renderSel() {
    const n = S.sel && byId[S.sel];
    if (!n) { $('net-sel').innerHTML = ''; return; }
    const ps = n.w.map((i) => D.works[i]);
    $('net-sel').innerHTML = `<div class="card" style="margin-bottom:1rem">
      <div style="display:flex;justify-content:space-between;gap:.5rem;align-items:flex-start">
        <div><div style="font-weight:600;font-size:1.05rem">${esc(n.n)}</div><div class="small muted">${esc(n.inst || 'Institution not recorded')}</div></div>
        <button type="button" class="btn" data-act="clear-sel" aria-label="Close" style="border:none">×</button>
      </div>
      <p style="margin:.6rem 0 .4rem;font-size:.85rem;font-weight:600;color:var(--navy)">${plural(ps.length, 'shared paper')}</p>
      <ul style="margin:0;padding-left:1.1em;font-size:.85rem;display:flex;flex-direction:column;gap:.4rem">${ps.slice(0, 6).map((w) => `<li><a href="${esc(w.href || w.gs)}">${esc(w.t)}</a> <span class="muted">(${w.y || '—'})</span></li>`).join('')}${ps.length > 6 ? `<li class="muted">… and ${ps.length - 6} more in the list below</li>` : ''}</ul>
    </div>`;
  }
  function renderInsts() {
    $('insts').innerHTML = D.inst.map(([n, c]) => `<span class="inst">${esc(n)} <span class="muted">${plural(c, 'paper')}</span></span>`).join('');
  }
  function play() {
    if (timer) { clearInterval(timer); timer = null; S.playing = false; setPlay(); return; }
    const years = [...new Set(D.nodes.filter((n) => n.id !== 'me').map((n) => n.fy))].sort((a, b) => a - b);
    let i = 0;
    const reveal = (yr) => {
      D.nodes.forEach((n) => { if (n.fy === yr && n.id !== 'me') { P[n.id].x = 400 + (Math.random() - 0.5) * 40; P[n.id].y = 260 + (Math.random() - 0.5) * 40; } });
      S.upto = yr; S.playing = true; setPlay(); reheat(0.8); renderPeople(); drawNetwork();
    };
    reveal(years[0]);
    timer = setInterval(() => { i++; if (i >= years.length) { clearInterval(timer); timer = null; S.playing = false; S.upto = null; setPlay(); renderPeople(); drawNetwork(); return; } reveal(years[i]); }, 1100);
  }
  function setPlay() { const b = $('net-play'); b.textContent = S.playing ? 'Pause' : '▶ Play'; b.setAttribute('aria-pressed', S.playing); }

  /* ---------- topics word cloud ---------- */
  function renderCloud() {
    const inF = new Set(F.map((w) => D.works.indexOf(w)));
    const wl = D.words.map(([l, idx]) => ({ l, all: idx.length, n: idx.filter((i) => inF.has(i)).length }));
    const wmax = Math.max(1, ...wl.map((x) => x.n));
    const arranged = []; wl.slice().sort((a, b) => b.all - a.all).forEach((x, i) => { if (i % 2) arranged.push(x); else arranged.unshift(x); });
    $('topics-intro').textContent = `Larger words appear in more papers${S.theme === 'all' ? '' : ' in ' + themeName()}. Select a topic to list its papers below.`;
    redraw($('cloud'), arranged.map((x) => { const r = x.n / wmax;
      return `<button type="button" data-act="topic" data-l="${esc(x.l)}" data-focus="t-${esc(x.l)}" aria-pressed="${S.topic === x.l}" title="${plural(x.n, 'paper')}" style="font-size:${(0.85 + r * 1.55).toFixed(2)}em;font-weight:${r > 0.6 ? 700 : r > 0.3 ? 600 : 500};color:${r > 0.45 ? 'var(--navy)' : '#3B5B8F'};opacity:${x.n ? 1 : 0.3}">${esc(x.l)}<span class="vh"> (${plural(x.n, 'paper')})</span></button>`; }).join(''));
  }

  /* ---------- research over time (theme x period dot grid) ---------- */
  function renderGrid() {
    const fy = (k) => Math.min(...D.works.filter((w) => w.th.indexOf(k) >= 0 && w.y).map((w) => w.y));
    const TH = D.themes.slice().sort((a, b) => fy(a[0]) - fy(b[0]));
    let cmax = 1; const g = {};
    TH.forEach((t) => { g[t[0]] = {}; PERIODS.forEach((p) => { const n = D.works.filter((w) => w.th.indexOf(t[0]) >= 0 && per(w.y) === p).length; g[t[0]][p] = n; cmax = Math.max(cmax, n); }); });
    const head = '<caption class="vh">Number of papers per research theme and period</caption><thead><tr><th scope="col" style="text-align:left">Theme</th>' + PERIODS.map((p) => `<th scope="col">${p}</th>`).join('') + '</tr></thead>';
    const body = '<tbody>' + TH.map((t) => `<tr style="opacity:${S.theme === 'all' || S.theme === t[0] ? 1 : 0.3}"><th scope="row">${esc(t[1])} <span class="muted" style="font-weight:400">${D.works.filter((w) => w.th.indexOf(t[0]) >= 0).length}</span></th>` +
      PERIODS.map((p) => { const n = g[t[0]][p]; if (!n) return '<td><span aria-label="no papers" style="color:var(--line)">·</span></td>';
        const d = Math.round(12 + Math.sqrt(n / cmax) * 28), on = S.cell && S.cell.th === t[0] && S.cell.p === p;
        const lab = `${t[1]}, ${p}: ${plural(n, 'paper')}`;
        return `<td><button type="button" class="dot-btn" data-act="cell" data-th="${esc(t[0])}" data-p="${esc(p)}" data-l="${esc(t[1])}" data-lab="${esc(lab)}" data-focus="c-${esc(t[0])}-${esc(p)}" aria-label="${esc(lab)}" aria-pressed="${!!on}"><span class="dot" style="width:${d}px;height:${d}px">${d >= 22 ? n : ''}</span></button></td>`; }).join('') + '</tr>').join('') + '</tbody>';
    redraw($('dotgrid'), head + body);
  }

  /* ---------- publication list ---------- */
  function bib(w) {
    const clean = (s) => s.normalize('NFD').replace(/[^A-Za-z]/g, '').toLowerCase();
    const first = clean(((w.af.split(',')[0] || 'anon').trim().split(/\s+/).pop()) || 'anon');
    const word = clean(w.t.split(/\s+/).find((x) => x.length > 3) || 'paper');
    const kind = w.k === 'Journal' ? 'article' : w.k === 'Conference' ? 'inproceedings' : w.k === 'Book chapter' ? 'incollection' : 'misc';
    const vf = kind === 'article' ? 'journal' : kind === 'misc' ? 'howpublished' : 'booktitle';
    const L = ['@' + kind + '{' + first + (w.y || 'nd') + word + ',', '  title = {' + w.t + '},', '  author = {' + w.af.replace(/,?\s*et al\.?$/, ', others').split(/,\s*/).join(' and ') + '},'];
    if (w.vfull || w.v) L.push('  ' + vf + ' = {' + (w.vfull || w.v) + '},');
    if (w.y) L.push('  year = {' + w.y + '},');
    if (w.doi) L.push('  doi = {' + w.doi.replace('https://doi.org/', '') + '},');
    return L.concat('}').join('\n');
  }
  function listFiltered() {
    const topicSet = S.topic ? new Set((D.words.find((x) => x[0] === S.topic) || [0, []])[1]) : null, q = S.q.trim().toLowerCase();
    const L = D.works.map((w, i) => Object.assign({ i }, w)).filter((w) => inTheme(w)
      && (!topicSet || topicSet.has(w.i))
      && (!S.cell || (w.th.indexOf(S.cell.th) >= 0 && per(w.y) === S.cell.p))
      && (S.fType === 'all' || w.k === S.fType)
      && (S.fYear === 'all' || (S.fYear === 'before2020' ? (w.y && w.y < 2020) : String(w.y) === S.fYear))
      && (!S.ranked || RANKED[w.tier]) && (!S.awarded || w.aw)
      && (!q || (w.t + ' ' + w.af + ' ' + (w.vfull || w.v)).toLowerCase().indexOf(q) >= 0));
    if (S.sort === 'cited') L.sort((a, b) => b.c - a.c || b.y - a.y); else L.sort((a, b) => (b.y || 0) - (a.y || 0) || b.c - a.c);
    return L;
  }
  function renderList() {
    const L = listFiltered(), cites = L.reduce((a, w) => a + w.c, 0);
    $('list-summary').textContent = (L.length === D.works.length ? '' : `Showing ${L.length} of `) + `${D.works.length} publications · ${cites} citations`;
    const chips = [];
    if (S.cell) chips.push(`<button type="button" class="pill" data-act="clear-cell">${esc(S.cell.l + ' · ' + S.cell.p)} ×</button>`);
    if (S.topic) chips.push(`<button type="button" class="pill" data-act="clear-topic">Topic: ${esc(S.topic)} ×</button>`);
    if (S.q || S.fType !== 'all' || S.fYear !== 'all' || S.ranked || S.awarded || S.topic || S.cell) chips.push('<button type="button" class="btn" data-act="clear-list" style="min-height:36px">Clear filters</button>');
    $('active-filters').innerHTML = chips.join('');
    if (!L.length) { $('pub-list').innerHTML = '<p class="empty">No publications match these filters. <button type="button" class="btn" data-act="clear-list" style="min-height:36px">Clear filters</button></p>'; return; }
    const shown = L.slice(0, S.limit), groups = [];
    if (S.sort === 'cited') groups.push({ label: 'Most cited', count: '', items: shown });
    else shown.forEach((w) => { const lab = w.y ? String(w.y) : 'Undated'; let g = groups[groups.length - 1];
      if (!g || g.label !== lab) { const n = L.filter((x) => (x.y ? String(x.y) : 'Undated') === lab).length; g = { label: lab, count: plural(n, 'paper'), items: [] }; groups.push(g); } g.items.push(w); });
    const item = (w) => { const open = S.open === w.i;
      return `<li class="paper"><a class="paper-title" href="${esc(w.href || w.gs)}">${esc(w.t)}</a>
        <div class="paper-meta" style="margin-top:.25rem">${authors(w.af)}</div>
        <div class="paper-meta"><em>${esc(w.v || 'Venue not recorded')}</em>${w.y ? ', ' + w.y : ''}</div>
        <div class="badges"><span class="badge">${esc(w.k)}</span>${w.tier ? `<span class="badge badge-rank">${esc(w.tier)}</span>` : ''}${w.aw ? `<span class="badge badge-award">★ ${esc(w.aw)}</span>` : ''}<span class="muted">${plural(w.c, 'citation')}</span>
          <span style="flex:1 1 auto"></span><span class="links-inline">${w.doi ? `<a href="${esc(w.doi)}">DOI</a>` : ''}<a href="${esc(w.gs)}">Google Scholar</a></span>
          <button type="button" class="btn" style="min-height:32px" data-act="cite" data-i="${w.i}" data-focus="cite-${w.i}" aria-expanded="${open}">Cite</button></div>
        ${open ? `<div class="panel" style="margin-top:.7rem;background:var(--soft)"><pre class="bib">${esc(bib(w))}</pre><div style="padding:0 1rem .8rem;display:flex;gap:.8rem;align-items:center"><button type="button" class="btn-primary" style="min-height:36px;border:none;cursor:pointer;font-size:.85rem" data-act="copy" data-i="${w.i}">Copy BibTeX</button><span class="small muted" aria-live="polite">${S.copied === w.i ? 'Copied.' : S.copied === -1 ? 'Copying is blocked here; select the text above instead.' : ''}</span></div></div>` : ''}
      </li>`; };
    redraw($('pub-list'), groups.map((g) => `<h3 class="group-h"><span>${esc(g.label)}</span><span>${esc(g.count)}</span></h3><ol style="list-style:none;margin:0;padding:0">${g.items.map(item).join('')}</ol>`).join('') +
      (L.length > S.limit ? `<div class="more"><button type="button" class="btn" data-act="more" data-focus="more">Show ${Math.min(20, L.length - S.limit)} more (${L.length - S.limit} remaining)</button></div>` : ''));
  }

  /* ---------- events ---------- */
  function wire() {
    const main = $('main');
    delegate(main, 'click', {
      theme: (el) => { S.theme = el.dataset.k; S.sel = null; reheat(0.4); renderAll(); },
      person: (el) => { S.sel = S.sel === el.dataset.id ? null : el.dataset.id; renderPeople(); renderSel(); drawNetwork(); },
      'clear-sel': () => { S.sel = null; renderPeople(); renderSel(); drawNetwork(); },
      topic: (el) => { S.topic = S.topic === el.dataset.l ? null : el.dataset.l; S.limit = 20; renderCloud(); renderList(); },
      cell: (el) => { const same = S.cell && S.cell.th === el.dataset.th && S.cell.p === el.dataset.p; S.cell = same ? null : { th: el.dataset.th, p: el.dataset.p, l: el.dataset.l }; S.limit = 20; renderGrid(); renderList(); },
      'clear-cell': () => { S.cell = null; renderGrid(); renderList(); },
      'clear-topic': () => { S.topic = null; renderCloud(); renderList(); },
      'clear-list': () => { Object.assign(S, { q: '', fType: 'all', fYear: 'all', ranked: false, awarded: false, topic: null, cell: null, limit: 20 });
        $('q').value = ''; $('f-type').value = 'all'; $('f-year').value = 'all'; $('f-ranked').checked = false; $('f-award').checked = false; renderCloud(); renderGrid(); renderList(); },
      more: () => { S.limit += 20; renderList(); },
      cite: (el) => { const i = +el.dataset.i; S.open = S.open === i ? null : i; S.copied = null; renderList(); },
      copy: (el) => { const i = +el.dataset.i, txt = bib(Object.assign({ i }, D.works[i]));
        const done = (ok) => { S.copied = ok ? i : -1; renderList(); };
        try { navigator.clipboard.writeText(txt).then(() => done(true), () => done(false)); } catch (e) { done(false); } },
    });
    $('table-toggle').addEventListener('click', () => { S.table = !S.table; renderPubs(); });
    $('pubs-chart').addEventListener('mouseover', (e) => { const b = e.target.closest('.bar'); if (b) pubsHover(b.dataset.y); });
    $('pubs-chart').addEventListener('mouseleave', () => pubsHover(null));
    $('cites-chart').addEventListener('mouseover', (e) => { const b = e.target.closest('[data-cy]'); if (b) $('cites-readout').textContent = `${b.dataset.cy}: ${D.cby[b.dataset.cy]} citations${+b.dataset.cy === NOW ? ' so far' : ''}`; });
    $('cites-chart').addEventListener('mouseleave', () => { $('cites-readout').textContent = 'Hover over a year to see its citations.'; });
    const tr = (e) => { const b = e.target.closest('[data-lab]'); $('time-readout').textContent = b ? b.dataset.lab : 'Hover over or select a dot.'; };
    $('dotgrid').addEventListener('mouseover', tr); $('dotgrid').addEventListener('focusin', tr);
    $('people').addEventListener('mouseover', (e) => { const b = e.target.closest('[data-id]'); if (b && S.hoverNode !== b.dataset.id) { S.hoverNode = b.dataset.id; drawNetwork(); } });
    $('people').addEventListener('mouseleave', () => { S.hoverNode = null; drawNetwork(); });
    $('q').addEventListener('input', (e) => { S.q = e.target.value; S.limit = 20; renderList(); });
    $('f-type').addEventListener('change', (e) => { S.fType = e.target.value; S.limit = 20; renderList(); });
    $('f-year').addEventListener('change', (e) => { S.fYear = e.target.value; S.limit = 20; renderList(); });
    $('f-sort').addEventListener('change', (e) => { S.sort = e.target.value; renderList(); });
    $('f-ranked').addEventListener('change', (e) => { S.ranked = e.target.checked; S.limit = 20; renderList(); });
    $('f-award').addEventListener('change', (e) => { S.awarded = e.target.checked; S.limit = 20; renderList(); });
    $('net-play').addEventListener('click', play);
    document.addEventListener('eo:display', drawNetwork);
    $('net-shuffle').addEventListener('click', () => { Object.keys(P).forEach((id) => { if (id !== 'me') { P[id].x = 400 + (P[id].x - 400) * 0.35 + (Math.random() - 0.5) * 60; P[id].y = 260 + (P[id].y - 260) * 0.35 + (Math.random() - 0.5) * 60; } }); reheat(1); });
    // dragging and hovering people in the network
    const svg = $('net-svg');
    const toSvg = (e) => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) * 800 / r.width, y: (e.clientY - r.top) * 520 / r.height }; };
    let start = null;
    svg.addEventListener('pointerdown', (e) => { const c = e.target.closest('circle[data-id]'); if (!c) return; e.preventDefault(); drag = c.dataset.id; dragMoved = false; start = toSvg(e); svg.setPointerCapture(e.pointerId); alpha = Math.max(alpha, 0.3); });
    svg.addEventListener('pointermove', (e) => {
      if (drag) { const q = toSvg(e); if (Math.abs(q.x - start.x) + Math.abs(q.y - start.y) > 4) dragMoved = true; P[drag].x = Math.max(24, Math.min(776, q.x)); P[drag].y = Math.max(24, Math.min(496, q.y)); alpha = Math.max(alpha, 0.3); if (reduceMotion()) drawNetwork(); return; }
      const c = e.target.closest('circle[data-id]'), id = c ? c.dataset.id : null;
      if (id !== S.hoverNode) { S.hoverNode = id; drawNetwork(); }
    });
    const up = () => { if (!drag) return; const id = drag; drag = null; if (!dragMoved && id !== 'me') { S.sel = S.sel === id ? null : id; renderPeople(); renderSel(); } alpha = Math.max(alpha, 0.2); drawNetwork(); };
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    svg.addEventListener('pointerleave', () => { if (!drag && S.hoverNode) { S.hoverNode = null; drawNetwork(); } });
  }
})();
