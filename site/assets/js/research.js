/* Research page: theme filter, charts, co-author network, how themes connect (chord) and the publication list. */
(function () {
  const { esc, load, fail, plural, authors, delegate, reduceMotion } = window.EO;
  const $ = (id) => document.getElementById(id);
  const TYPES = [['Journal', 'var(--navy)', 'j'], ['Conference', 'var(--orange)', 'c'], ['Book chapter', 'var(--green)', 'b'], ['Preprint & other', 'var(--yellow)', 'p']];
  const RANKED = { 'CORE A*': 1, 'CORE A': 1, 'CORE B': 1, 'Q1': 1, 'Q2': 1 };
  const NOW = new Date().getFullYear();
  // theme colours for the chord only (validated for colour-blind readers; every arc is also labelled)
  const CHORD_COLOURS = ['#1F4E99', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
  const params = new URLSearchParams(location.search);
  const S = { theme: params.get('theme') || 'all', table: false, sel: null, hoverNode: null, upto: null, playing: false,
    topic: null, pair: null, q: '', fType: 'all', fYear: 'all', sort: 'new', ranked: false, awarded: false, limit: 20 };
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

  // research supervision (kept with the other supervision details in content/teaching.yaml)
  load('teaching').then((T) => {
    const items = T.research_supervision || [];
    if (!items.length) return;
    $('research-supervision').innerHTML = items.map((s) => `<li><span class="num">${esc(s.number)}</span><span>${esc(s.text)}</span></li>`).join('');
    $('supervision').hidden = false;
  }).catch(() => {});

  function renderAll() {
    F = D.works.filter(inTheme);
    renderChips(); renderKpis(); renderPubs(); renderCites(); renderPeople(); renderSel(); renderInsts(); renderChord(); renderList(); drawNetwork();
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
  const P = {}; let alpha = 1, drag = null, dragMoved = false, raf = null, timer = null, onScreen = true, NAVY = '#1F4E99', INK = '#16202C';
  const DRIFT = 0.05, FLOOR = 0.02; // gentle, never-ending float (off when the visitor prefers less motion)
  const colours = () => { NAVY = window.EO.css('--navy') || NAVY; INK = window.EO.css('--ink') || INK; };
  const rad = (n) => (n.id === 'me' ? 22 : Math.round(5 + Math.sqrt(n.p) * 3.2));
  const visible = (n) => S.upto == null || n.id === 'me' || n.fy <= S.upto;
  const lit = (n) => n.id === 'me' || S.theme === 'all' || n.th.indexOf(S.theme) >= 0;
  function initNetwork() {
    D.nodes.forEach((n, i) => { const a = i * 2.39996, r = n.id === 'me' ? 0 : 90 + (i % 7) * 25; P[n.id] = { x: 400 + Math.cos(a) * r, y: 260 + Math.sin(a) * r * 0.8, vx: 0, vy: 0, ph: i * 1.7 }; });
    colours();
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { onScreen = es[0].isIntersecting; }).observe($('net-svg'));
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
    const moving = !reduceMotion(), t = performance.now();
    vis.forEach((n) => {
      const p = P[n.id];
      if (n.id === 'me' && drag !== 'me') { p.x += (400 - p.x) * 0.1; p.y += (260 - p.y) * 0.1; p.vx = p.vy = 0; return; }
      if (drag === n.id) { p.vx = p.vy = 0; return; }
      p.vx += (400 - p.x) * 0.001 * alpha; p.vy += (260 - p.y) * 0.0015 * alpha;
      if (moving) { p.vx += Math.sin(t * 0.00055 + p.ph) * DRIFT; p.vy += Math.cos(t * 0.00047 + p.ph * 1.3) * DRIFT; }
      p.vx *= 0.6; p.vy *= 0.6;
      p.x = Math.max(24, Math.min(776, p.x + p.vx)); p.y = Math.max(24, Math.min(496, p.y + p.vy));
    });
    alpha = Math.max(drag ? 0.3 : reduceMotion() ? 0 : FLOOR, alpha * 0.985);
  }
  function loop() {
    const step = () => { if (drag || (onScreen && !document.hidden && (alpha > 0.01 || !reduceMotion()))) { tick(); drawNetwork(); } raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  }
  function reheat(v) { alpha = Math.max(alpha, v); if (reduceMotion()) { for (let i = 0; i < 300 && alpha > 0.01; i++) tick(); drawNetwork(); } }
  function drawNetwork() {
    if (!D) return;
    const f1 = (v) => v.toFixed(1), sel = S.sel, hov = S.hoverNode;
    const edges = D.edges.filter((e) => visible(byId[e.a]) && visible(byId[e.b])).map((e) => {
      const on = lit(byId[e.a]) && lit(byId[e.b]), touch = [sel, hov].some((x) => x && (e.a === x || e.b === x));
      return `<line x1="${f1(P[e.a].x)}" y1="${f1(P[e.a].y)}" x2="${f1(P[e.b].x)}" y2="${f1(P[e.b].y)}" stroke="${touch ? '#eb6834' : '#8FA3BF'}" stroke-width="${Math.min(6, 0.8 + e.w * 0.5)}" stroke-opacity="${on ? (touch ? 0.9 : 0.4) : 0.06}"/>`;
    }).join('');
    const nodes = D.nodes.filter(visible).slice().reverse().map((n) => {
      const isSel = sel === n.id, isHov = hov === n.id;
      return `<circle data-id="${esc(n.id)}" cx="${f1(P[n.id].x)}" cy="${f1(P[n.id].y)}" r="${rad(n) + (isHov ? 2 : 0)}" fill="${n.id === 'me' ? NAVY : isSel ? '#eb6834' : '#6E8FC9'}" fill-opacity="${lit(n) ? 1 : 0.15}" stroke="${isSel || isHov ? INK : '#fff'}" stroke-width="${isSel || isHov ? 3 : 2}" style="cursor:${drag === n.id ? 'grabbing' : 'grab'}"/>`;
    }).join('');
    const short = (s) => { const w = s.split(' '), i = w.length - 2; return w[0] + ' ' + (i > 0 && /^(de|da|do|dos|das|van|von|der|di|le|la)$/i.test(w[i]) ? w[i] + ' ' : '') + w[w.length - 1]; };
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

  /* ---------- how themes connect (chord diagram) ---------- */
  const C = { sel: null, edge: null, hov: null, geo: null };
  const tname = (c) => (D.themes.find((t) => t[0] === c) || ['', c])[1];
  const tcount = (c) => D.works.filter((w) => w.th.indexOf(c) >= 0).length;
  const tcol = (c) => CHORD_COLOURS[D.themes.findIndex((t) => t[0] === c) % CHORD_COLOURS.length];
  function chordGeo() {
    if (C.geo) return C.geo;
    const codes = D.themes.map((t) => t[0]), shared = [];
    codes.forEach((a, i) => codes.slice(i + 1).forEach((b) => {
      const papers = D.works.filter((w) => w.th.indexOf(a) >= 0 && w.th.indexOf(b) >= 0);
      if (papers.length) shared.push({ k: shared.length, a, b, n: papers.length, papers: papers.slice().sort((x, y) => y.c - x.c || y.y - x.y) });
    }));
    const tot = {}; codes.forEach((c) => { tot[c] = shared.filter((r) => r.a === c || r.b === c).reduce((s, r) => s + r.n, 0); });
    const GAP = 0.06, all = codes.reduce((s, c) => s + tot[c], 0) || 1, scale = (2 * Math.PI - GAP * codes.length) / all;
    const CX = 320, CY = 320, R0 = 210, R1 = 226, pt = (a, r) => [CX + r * Math.sin(a), CY - r * Math.cos(a)], f = (v) => v.toFixed(1);
    const start = {}; let ang = 0; codes.forEach((c) => { start[c] = ang; ang += tot[c] * scale + GAP; });
    const cur = Object.assign({}, start), seg = {};
    codes.forEach((c) => {
      const mine = shared.filter((r) => r.a === c || r.b === c).sort((x, y) => {
        const o = (r) => (codes.indexOf(r.a === c ? r.b : r.a) - codes.indexOf(c) + codes.length) % codes.length; return o(x) - o(y); });
      mine.forEach((r) => { const a0 = cur[c], a1 = a0 + r.n * scale; seg[r.k + c] = [a0, a1]; cur[c] = a1; });
    });
    shared.forEach((r) => {
      const [a0, a1] = seg[r.k + r.a], [b0, b1] = seg[r.k + r.b], p0 = pt(a0, R0), p1 = pt(a1, R0), q0 = pt(b0, R0), q1 = pt(b1, R0);
      r.pa = pt((a0 + a1) / 2, R0 - 4); r.pb = pt((b0 + b1) / 2, R0 - 4);
      r.d = `M${f(p0[0])},${f(p0[1])} A${R0},${R0} 0 0 1 ${f(p1[0])},${f(p1[1])} Q${CX},${CY} ${f(q0[0])},${f(q0[1])} A${R0},${R0} 0 0 1 ${f(q1[0])},${f(q1[1])} Q${CX},${CY} ${f(p0[0])},${f(p0[1])} Z`;
    });
    const arcs = codes.filter((c) => tot[c]).map((c) => {
      const a0 = start[c], a1 = a0 + tot[c] * scale, large = a1 - a0 > Math.PI ? 1 : 0, o0 = pt(a0, R1), o1 = pt(a1, R1), i1 = pt(a1, R0 + 3), i0 = pt(a0, R0 + 3);
      const mid = (a0 + a1) / 2, l = pt(mid, R1 + 16), s = Math.sin(mid);
      return { c, d: `M${f(o0[0])},${f(o0[1])} A${R1},${R1} 0 ${large} 1 ${f(o1[0])},${f(o1[1])} L${f(i1[0])},${f(i1[1])} A${R0 + 3},${R0 + 3} 0 ${large} 0 ${f(i0[0])},${f(i0[1])} Z`,
        x: l[0], y: l[1] + (Math.cos(mid) < -0.5 ? 14 : 0), anchor: s > 0.15 ? 'start' : s < -0.15 ? 'end' : 'middle' };
    });
    return (C.geo = { codes, shared, arcs, CX, CY });
  }
  function renderChord() {
    const G = chordGeo();
    if (!C.sel || (S.theme !== 'all' && C.sel !== S.theme && !C.userPicked)) C.sel = S.theme !== 'all' ? S.theme : G.codes.slice().sort((a, b) => tcount(b) - tcount(a))[0];
    C.userPicked = false;
    redraw($('chord-themes'), G.codes.map((c) => `<button type="button" class="chip" data-act="ch-theme" data-k="${esc(c)}" data-focus="ch-${esc(c)}" aria-pressed="${C.sel === c}"><span class="sw" style="background:${tcol(c)}"></span>${esc(tname(c))}</button>`).join(''));
    paintChord();
    renderChordPanel();
    if (!FLOW.raf) startChordMotion();
  }
  function buildChord() {
    const G = chordGeo(), svg = $('chord-svg');
    svg.innerHTML = `<g id="chord-shapes">${G.shared.map((r, i) => `<path class="rib" style="--i:${i}" data-act="ch-edge" data-k="${r.k}" data-rib="${r.k}" d="${r.d}"></path>`).join('')}
      ${G.arcs.map((a) => `<g class="arc" data-act="ch-theme" data-k="${esc(a.c)}" data-arc="${esc(a.c)}"><path d="${a.d}" fill="${tcol(a.c)}"></path>
        <text x="${a.x.toFixed(1)}" y="${a.y.toFixed(1)}" text-anchor="${a.anchor}" font-size="18" fill="var(--ink)">${esc(tname(a.c))}</text>
        <text x="${a.x.toFixed(1)}" y="${(a.y + 21).toFixed(1)}" text-anchor="${a.anchor}" font-size="15" fill="var(--muted)">${plural(tcount(a.c), 'paper')}</text></g>`).join('')}</g>
      <g id="chord-flow" aria-hidden="true" pointer-events="none"></g>`;
    C.built = true;
  }
  // what is in focus: hover wins, then the selected relationship, then the selected theme
  function chordFocus() {
    const G = chordGeo(), H = C.hov;
    const fEdge = H && H.kind === 'edge' ? H.k : (H ? null : C.edge);
    const fTheme = H && H.kind === 'theme' ? H.c : (fEdge === null ? C.sel : null);
    return { fEdge, fTheme, ends: fEdge !== null ? [G.shared[fEdge].a, G.shared[fEdge].b] : [fTheme] };
  }
  function paintChord() {
    if (!C.built) buildChord();
    const G = chordGeo(), F = chordFocus();
    $('chord-svg').querySelectorAll('.rib').forEach((el) => {
      const r = G.shared[+el.dataset.k];
      let on, fill;
      if (F.fEdge !== null) { on = r.k === F.fEdge; fill = on ? tcol(r.a === C.sel ? r.b : r.a) : '#B9C4D3'; }
      else { on = r.a === F.fTheme || r.b === F.fTheme; fill = on ? tcol(r.a === F.fTheme ? r.b : r.a) : '#B9C4D3'; }
      el.style.fill = fill;
      el.style.fillOpacity = F.fEdge !== null ? (on ? 0.9 : 0.12) : (on ? 0.7 : 0.2);
      el.style.stroke = on && F.fEdge !== null ? 'var(--ink)' : '#fff';
      el.style.strokeWidth = on && F.fEdge !== null ? 1.5 : 1;
    });
    $('chord-svg').querySelectorAll('.arc').forEach((g) => {
      const lit = F.ends.indexOf(g.dataset.arc) >= 0;
      g.querySelector('path').style.fillOpacity = lit || (F.fTheme === null && F.fEdge === null) ? 1 : 0.45;
      g.querySelector('text').style.fontWeight = lit ? 700 : 500;
    });
    flowTarget();
  }
  /* gentle flow: dots drift along the lit ribbons, away from the theme in focus */
  const FLOW = { key: '', dots: [], raf: null, last: 0, seen: false, visible: false };
  function flowTarget() {
    const G = chordGeo(), F = chordFocus(), g = $('chord-flow');
    if (!g) return;
    const lit = F.fEdge !== null ? [G.shared[F.fEdge]] : G.shared.filter((r) => r.a === F.fTheme || r.b === F.fTheme);
    const from = F.fEdge !== null ? (G.shared[F.fEdge].b === C.sel ? G.shared[F.fEdge].b : G.shared[F.fEdge].a) : F.fTheme;
    const key = lit.map((r) => r.k).join(',') + '|' + from;
    if (key === FLOW.key) return;
    FLOW.key = key; FLOW.dots = [];
    lit.forEach((r) => {
      const fwd = r.a === from, n = Math.max(1, Math.min(4, Math.ceil(r.n / 4)));
      for (let j = 0; j < n; j++) FLOW.dots.push({ p0: fwd ? r.pa : r.pb, p2: fwd ? r.pb : r.pa, t: j / n + Math.random() * 0.1 });
    });
    g.innerHTML = FLOW.dots.map(() => '<circle r="4.6" fill="#fff" stroke="rgba(22,32,44,0.45)" stroke-width="1"></circle>').join('');
    drawFlow();
  }
  function drawFlow() {
    const G = chordGeo(), els = $('chord-flow') ? $('chord-flow').children : [];
    FLOW.dots.forEach((d, i) => {
      const t = d.t % 1, u = 1 - t, x = u * u * d.p0[0] + 2 * u * t * G.CX + t * t * d.p2[0], y = u * u * d.p0[1] + 2 * u * t * G.CY + t * t * d.p2[1];
      if (els[i]) { els[i].setAttribute('cx', x.toFixed(1)); els[i].setAttribute('cy', y.toFixed(1)); els[i].setAttribute('opacity', Math.sin(Math.PI * t).toFixed(2)); }
    });
  }
  function flowLoop(now) {
    const dt = FLOW.last ? Math.min(50, now - FLOW.last) : 16; FLOW.last = now;
    if (FLOW.visible && !document.hidden && !reduceMotion()) { FLOW.dots.forEach((d) => { d.t += dt / 4500; }); drawFlow(); }
    $('chord-flow').style.display = reduceMotion() ? 'none' : '';
    FLOW.raf = requestAnimationFrame(flowLoop);
  }
  function startChordMotion() {
    const fig = $('chord-fig');
    const begin = () => {
      FLOW.visible = true;
      if (!FLOW.seen) {
        FLOW.seen = true;
        if (!reduceMotion()) { $('chord-svg').classList.add('reveal'); setTimeout(() => $('chord-svg').classList.remove('reveal'), 1800); }
      }
    };
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { if (es[0].isIntersecting) begin(); else FLOW.visible = false; }, { threshold: 0.25 }).observe(fig);
    else begin();
    if (!FLOW.raf) FLOW.raf = requestAnimationFrame(flowLoop);
  }

  function renderChordPanel() {
    const G = chordGeo(), el = $('chord-panel');
    if (C.edge !== null) {
      const r = G.shared[C.edge];
      redraw(el, `<div class="cp-head"><button type="button" class="linkbtn" data-act="ch-back" data-focus="ch-back">← Back to ${esc(tname(C.sel))}</button>
        <p class="kicker">Selected relationship</p><h3>${esc(tname(r.a))} + ${esc(tname(r.b))}</h3>
        <p class="muted" style="margin:0">${plural(r.n, 'shared paper')}. The most cited:</p></div>
        <ol class="chord-papers">${r.papers.slice(0, 3).map((w) => `<li><a href="${esc(w.href || w.gs || '#')}">${esc(w.t)}</a><span class="muted">${w.y} · ${plural(w.c, 'citation')}</span></li>`).join('')}</ol>
        <button type="button" class="btn cp-action" data-act="ch-pair" data-focus="ch-pair">See all ${plural(r.n, 'shared paper')} in the list</button>`);
      return;
    }
    const c = C.sel, links = G.shared.filter((r) => r.a === c || r.b === c).sort((x, y) => y.n - x.n);
    const tops = (D.theme_topics || {})[c] || [];
    redraw(el, `<div class="cp-head"><p class="kicker">Selected theme</p><h3>${esc(tname(c))}</h3>
      <p class="muted" style="margin:0">${plural(tcount(c), 'paper')}. ${links.length === G.codes.length - 1 ? 'It shares papers with every other theme.' : `It shares papers with ${links.length} of the other themes.`} Select one to see the papers they share.</p></div>
      <div class="cp-cols"><div><p class="sub">Connected to</p><ul class="chord-links">${links.map((r) => { const o = r.a === c ? r.b : r.a;
        return `<li><button type="button" data-act="ch-edge" data-k="${r.k}" data-focus="ch-e${r.k}"><span><span class="sw" style="background:${tcol(o)}"></span>${esc(tname(o))}</span><span class="muted">${r.n} shared →</span></button></li>`; }).join('')}</ul></div>
      <div style="display:flex;flex-direction:column;gap:1rem">${tops.length ? `<div><p class="sub">Main topics</p><div class="chord-topics">${tops.map(([l, n]) => `<button type="button" class="chip" data-act="ch-topic" data-l="${esc(l)}" data-focus="ch-t-${esc(l)}">${esc(l)} <span class="n">${n}</span></button>`).join('')}</div></div>` : ''}
      <button type="button" class="btn cp-action" data-act="ch-papers" data-focus="ch-papers">Show the ${plural(tcount(c), 'paper')} in this theme</button></div></div>`);
  }
  function chordTip(e) {
    const G = chordGeo(), tip = $('chord-tip'), H = C.hov;
    if (!H) { tip.hidden = true; return; }
    let html;
    if (H.kind === 'theme') {
      const links = G.shared.filter((r) => r.a === H.c || r.b === H.c).sort((x, y) => y.n - x.n), best = links[0];
      const tops = ((D.theme_topics || {})[H.c] || []).slice(0, 3).map((x) => x[0]);
      html = `<strong>${esc(tname(H.c))}</strong><span class="muted">${plural(tcount(H.c), 'paper')} · select to explore</span>` +
        (tops.length ? `<span>Main topics: ${esc(tops.join(', '))}</span>` : '') +
        (best ? `<span>Most connected to ${esc(tname(best.a === H.c ? best.b : best.a))} (${best.n} shared)</span>` : '');
    } else {
      const r = G.shared[H.k];
      html = `<strong>${esc(tname(r.a))} + ${esc(tname(r.b))}</strong><span class="muted">${plural(r.n, 'shared paper')} · select to see them</span>` +
        r.papers.slice(0, 2).map((w) => `<span>“${esc(w.t.length > 80 ? w.t.slice(0, 78) + '…' : w.t)}” (${w.y})</span>`).join('');
    }
    tip.innerHTML = html; tip.hidden = false;
    if (e) {
      const fig = $('chord-fig'), b = fig.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
      tip.style.left = (x > b.width - 300 ? Math.max(0, x - 290) : x + 18) + 'px'; tip.style.top = (y + 14) + 'px';
    }
  }
  const toList = () => { const l = $('publications'); if (l) l.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }); };

  /* ---------- publication list ---------- */
  function listFiltered() {
    const topicSet = S.topic ? new Set((D.words.find((x) => x[0] === S.topic) || [0, []])[1]) : null, q = S.q.trim().toLowerCase();
    const L = D.works.map((w, i) => Object.assign({ i }, w)).filter((w) => inTheme(w)
      && (!topicSet || topicSet.has(w.i))
      && (!S.pair || (w.th.indexOf(S.pair[0]) >= 0 && w.th.indexOf(S.pair[1]) >= 0))
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
    if (S.pair) chips.push(`<button type="button" class="pill" data-act="clear-pair">Shared by ${esc(tname(S.pair[0]))} + ${esc(tname(S.pair[1]))} ×</button>`);
    if (S.topic) chips.push(`<button type="button" class="pill" data-act="clear-topic">Topic: ${esc(S.topic)} ×</button>`);
    if (S.q || S.fType !== 'all' || S.fYear !== 'all' || S.ranked || S.awarded || S.topic || S.pair) chips.push('<button type="button" class="btn" data-act="clear-list" style="min-height:36px">Clear filters</button>');
    $('active-filters').innerHTML = chips.join('');
    if (!L.length) { $('pub-list').innerHTML = '<p class="empty">No publications match these filters. <button type="button" class="btn" data-act="clear-list" style="min-height:36px">Clear filters</button></p>'; return; }
    const shown = L.slice(0, S.limit), groups = [];
    if (S.sort === 'cited') groups.push({ label: 'Most cited', count: '', items: shown });
    else shown.forEach((w) => { const lab = w.y ? String(w.y) : 'Undated'; let g = groups[groups.length - 1];
      if (!g || g.label !== lab) { const n = L.filter((x) => (x.y ? String(x.y) : 'Undated') === lab).length; g = { label: lab, count: plural(n, 'paper'), items: [] }; groups.push(g); } g.items.push(w); });
    const item = (w) => {
      return `<li class="paper"><a class="paper-title" href="${esc(w.href || w.gs)}">${esc(w.t)}</a>
        <div class="paper-meta" style="margin-top:.25rem">${authors(w.af)}</div>
        <div class="paper-meta"><em>${esc(w.v || 'Venue not recorded')}</em>${w.y ? ', ' + w.y : ''}</div>
        <div class="badges"><span class="badge">${esc(w.k)}</span>${w.tier ? `<span class="badge badge-rank">${esc(w.tier)}</span>` : ''}${w.aw ? `<span class="badge badge-award">★ ${esc(w.aw)}</span>` : ''}<span class="muted">${plural(w.c, 'citation')}</span>
          <span style="flex:1 1 auto"></span><span class="links-inline">${w.doi ? `<a href="${esc(w.doi)}">DOI</a>` : ''}${w.gs ? `<a href="${esc(w.gs)}">Google Scholar</a>` : ''}</span></div>
      </li>`; };
    redraw($('pub-list'), groups.map((g) => `<h3 class="group-h"><span>${esc(g.label)}</span><span>${esc(g.count)}</span></h3><ol style="list-style:none;margin:0;padding:0">${g.items.map(item).join('')}</ol>`).join('') +
      (L.length > S.limit ? `<div class="more"><button type="button" class="btn" data-act="more" data-focus="more">Show ${Math.min(20, L.length - S.limit)} more (${L.length - S.limit} remaining)</button></div>` : ''));
  }

  /* ---------- events ---------- */
  function wire() {
    const main = $('main');
    delegate(main, 'click', {
      theme: (el) => { S.theme = el.dataset.k; S.sel = null; C.edge = null; reheat(0.4); renderAll(); },
      person: (el) => { S.sel = S.sel === el.dataset.id ? null : el.dataset.id; renderPeople(); renderSel(); drawNetwork(); },
      'clear-sel': () => { S.sel = null; renderPeople(); renderSel(); drawNetwork(); },
      'ch-theme': (el) => { C.sel = el.dataset.k; C.edge = null; C.userPicked = true; renderChord(); },
      'ch-edge': (el) => { C.edge = +el.dataset.k; C.hov = null; $('chord-tip').hidden = true; paintChord(); renderChordPanel(); },
      'ch-back': () => { C.edge = null; paintChord(); renderChordPanel(); },
      'ch-pair': () => { const r = chordGeo().shared[C.edge]; S.pair = [r.a, r.b]; S.topic = null; S.limit = 20; renderList(); toList(); },
      'ch-papers': () => { S.theme = C.sel; S.sel = null; C.userPicked = true; reheat(0.4); renderAll(); toList(); },
      'ch-topic': (el) => { S.topic = el.dataset.l; S.pair = null; S.limit = 20; renderList(); toList(); },
      'clear-pair': () => { S.pair = null; renderList(); },
      'clear-topic': () => { S.topic = null; renderList(); },
      'clear-list': () => { Object.assign(S, { q: '', fType: 'all', fYear: 'all', ranked: false, awarded: false, topic: null, pair: null, limit: 20 });
        $('q').value = ''; $('f-type').value = 'all'; $('f-year').value = 'all'; $('f-ranked').checked = false; $('f-award').checked = false; renderList(); },
      more: () => { S.limit += 20; renderList(); },
    });
    $('table-toggle').addEventListener('click', () => { S.table = !S.table; renderPubs(); });
    $('pubs-chart').addEventListener('mouseover', (e) => { const b = e.target.closest('.bar'); if (b) pubsHover(b.dataset.y); });
    $('pubs-chart').addEventListener('mouseleave', () => pubsHover(null));
    $('cites-chart').addEventListener('mouseover', (e) => { const b = e.target.closest('[data-cy]'); if (b) $('cites-readout').textContent = `${b.dataset.cy}: ${D.cby[b.dataset.cy]} citations${+b.dataset.cy === NOW ? ' so far' : ''}`; });
    $('cites-chart').addEventListener('mouseleave', () => { $('cites-readout').textContent = 'Hover over a year to see its citations.'; });
    // chord: hover details follow the pointer
    const csvg = $('chord-svg');
    csvg.addEventListener('mousemove', (e) => {
      const r = e.target.closest('[data-rib]'), a = e.target.closest('[data-arc]');
      const h = r ? { kind: 'edge', k: +r.dataset.rib } : a ? { kind: 'theme', c: a.dataset.arc } : null;
      const same = (h && C.hov && h.kind === C.hov.kind && h.k === C.hov.k && h.c === C.hov.c) || (!h && !C.hov);
      C.hov = h; if (!same) paintChord(); chordTip(e);
    });
    csvg.addEventListener('mouseleave', () => { C.hov = null; paintChord(); chordTip(); });
    $('people').addEventListener('mouseover', (e) => { const b = e.target.closest('[data-id]'); if (b && S.hoverNode !== b.dataset.id) { S.hoverNode = b.dataset.id; drawNetwork(); } });
    $('people').addEventListener('mouseleave', () => { S.hoverNode = null; drawNetwork(); });
    $('q').addEventListener('input', (e) => { S.q = e.target.value; S.limit = 20; renderList(); });
    $('f-type').addEventListener('change', (e) => { S.fType = e.target.value; S.limit = 20; renderList(); });
    $('f-year').addEventListener('change', (e) => { S.fYear = e.target.value; S.limit = 20; renderList(); });
    $('f-sort').addEventListener('change', (e) => { S.sort = e.target.value; renderList(); });
    $('f-ranked').addEventListener('change', (e) => { S.ranked = e.target.checked; S.limit = 20; renderList(); });
    $('f-award').addEventListener('change', (e) => { S.awarded = e.target.checked; S.limit = 20; renderList(); });
    $('net-play').addEventListener('click', play);
    document.addEventListener('eo:display', () => { colours(); drawNetwork(); });
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
