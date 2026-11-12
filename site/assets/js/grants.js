/* Grants page: source and role filters, headline numbers, timeline, details, funding by source and the full list. */
(function () {
  const { esc, load, fail, plural, delegate } = window.EO;
  const $ = (id) => document.getElementById(id);
  const SOURCES = ['University of Melbourne', 'Australian Government', 'International', 'Industry'];
  const ROLE_CLASS = { 'Lead': 'role-lead', 'Chief Investigator': 'role-ci', 'Co-investigator': 'role-coi' };
  const ROLE_LABEL = { 'Lead': 'Lead (PI)', 'Chief Investigator': 'Chief Investigator', 'Co-investigator': 'Co-investigator' };
  const NOW = new Date().getFullYear();
  const S = { src: 'all', role: 'all', sel: null };
  let G, Y0, Y1;
  const fmt = (n) => (n >= 1e6 ? 'A$' + (n / 1e6).toFixed(2).replace(/0$/, '') + 'M' : 'A$' + Math.round(n / 1000) + 'k');
  const sum = (xs) => xs.reduce((a, g) => a + (g.aud || 0), 0);
  const usd = (xs) => xs.reduce((a, g) => a + (g.usd || 0), 0);
  const years = (g) => (g.end > g.start ? g.start + '–' + String(g.end).slice(2) : String(g.start));
  const team = (t) => (t && t.length ? t.map((n, i) => `<span${/oliveira/i.test(n) ? ' class="me"' : ''}>${esc(n)}${i < t.length - 1 ? ', ' : ''}</span>`).join('') : '<span class="muted">Team to be added</span>');

  load('grants').then((d) => {
    G = d.grants.map((g, i) => Object.assign({ i }, g)).sort((a, b) => b.start - a.start || b.end - a.end);
    Y0 = Math.min(...G.map((g) => g.start)); Y1 = Math.max(NOW + 2, ...G.map((g) => g.end));
    S.sel = (G.find((g) => g.end >= NOW) || G[0]).i;
    const axis = []; for (let y = Y0; y <= Y1; y++) axis.push(`<span style="font-weight:${y === NOW ? 700 : 400}">'${String(y).slice(2)}</span>`);
    $('tl-axis').innerHTML = axis.join('');
    wire(); render();
  }).catch((e) => fail($('kpis'), e));

  function render() {
    const byRole = G.filter((g) => S.role === 'all' || g.role === S.role);
    const F = byRole.filter((g) => S.src === 'all' || g.source === S.src);
    $('src-chips').innerHTML = [['all', 'All sources', byRole.length]].concat(SOURCES.map((s) => [s, s, byRole.filter((g) => g.source === s).length]))
      .map(([k, l, n]) => `<button type="button" class="chip" data-act="src" data-k="${esc(k)}" aria-pressed="${S.src === k}">${esc(l)} <span class="n">${n}</span></button>`).join('');
    const u = usd(F), cnt = (r) => F.filter((g) => g.role === r).length;
    $('kpis').innerHTML = [[fmt(sum(F)), u ? 'total funding, plus US$' + u.toLocaleString('en-AU') : 'total funding'], [F.length, F.length === 1 ? 'funded project' : 'funded projects'],
      [cnt('Lead'), 'as lead (Principal Investigator)'], [cnt('Chief Investigator'), 'as Chief Investigator'], [cnt('Co-investigator'), 'as co-investigator'], [F.filter((g) => g.end >= NOW).length, 'current projects']]
      .map(([v, l]) => `<div><div class="stat-v">${esc(v)}</div><div class="stat-l">${esc(l)}</div></div>`).join('');
    const span = Y1 - Y0 + 1, nowLeft = ((NOW - Y0 + 0.5) / span * 100).toFixed(2);
    const short = (g) => (g.title.startsWith('[') ? g.funder.split(',')[0] + ' (' + g.start + ')' : g.title.length > 58 ? g.title.slice(0, 56).replace(/[\s,:;]+\S*$/, '') + '…' : g.title);
    $('timeline').innerHTML = F.map((g) => `<li><button type="button" data-act="sel" data-i="${g.i}" aria-pressed="${S.sel === g.i}" aria-label="${esc(g.title + ', ' + years(g) + ', ' + ROLE_LABEL[g.role] + ', ' + g.amount)}">
      <span class="tl-label" style="font-weight:${S.sel === g.i ? 700 : 500}">${esc(short(g))}</span>
      <span class="tl-track"><span class="tl-now" style="left:${nowLeft}%"></span><span class="tl-bar ${ROLE_CLASS[g.role]}" style="left:${((g.start - Y0) / span * 100).toFixed(2)}%;width:${((g.end - g.start + 1) / span * 100).toFixed(2)}%${S.sel === g.i ? ';box-shadow:0 0 0 2px #fff,0 0 0 4px var(--ink)' : ''}"></span></span></button></li>`).join('');
    const s = G.find((g) => g.i === S.sel);
    $('details').innerHTML = s ? `<div class="card"><p style="margin:0 0 .3rem;font-size:.82rem;font-weight:600;color:var(--navy)">${esc(years(s))} · ${esc(ROLE_LABEL[s.role])}</p>
      <h3 style="margin:0 0 .6rem;font-size:1.05rem;line-height:1.35">${esc(s.title)}</h3>
      <dl class="meta"><dt>Funder</dt><dd>${esc(s.funder)}</dd><dt>Amount</dt><dd style="font-weight:600">${esc(s.amount)}</dd><dt>Team</dt><dd>${team(s.team)}</dd></dl>
      ${s.related ? `<p style="margin:.8rem 0 0;font-size:.85rem"><strong>Related:</strong> ${s.related_url ? `<a href="${esc(s.related_url)}">${esc(s.related)}</a>` : esc(s.related)}</p>` : ''}</div>`
      : '<p class="empty" style="margin:0">Select a project in the timeline to see its funder, amount and team.</p>';
    const smax = Math.max(1, ...SOURCES.map((x) => sum(byRole.filter((g) => g.source === x))));
    $('by-source').innerHTML = SOURCES.map((x) => { const xs = byRole.filter((g) => g.source === x), u2 = usd(xs);
      return `<li style="padding:.45rem 0;font-size:.88rem"><div style="display:flex;justify-content:space-between;gap:.6rem"><span>${esc(x)}</span><span style="font-weight:600;white-space:nowrap">${fmt(sum(xs))}${u2 ? ' + US$' + Math.round(u2 / 1000) + 'k' : ''}</span></div>
        <div class="hbar" aria-hidden="true"><span style="width:${Math.round(sum(xs) / smax * 100)}%"></span></div><div class="small muted" style="margin-top:.2rem">${plural(xs.length, 'project')}</div></li>`; }).join('');
    $('list-summary').textContent = `${plural(F.length, 'project')} · ${fmt(sum(F))}${u ? ' + US$' + u.toLocaleString('en-AU') : ''} · newest first`;
    const card = (g) => `<li style="display:flex;flex-wrap:wrap;gap:.3rem 1.5rem;padding:1rem .4rem;border-bottom:1px solid var(--line);background:${S.sel === g.i ? 'var(--hover)' : 'transparent'}">
      <span style="flex:0 0 6.5rem;font-weight:600;color:var(--navy)">${esc(years(g))}</span>
      <span style="flex:1 1 460px;min-width:0"><span style="display:block;font-weight:600;line-height:1.4">${esc(g.title)}</span>
        <span class="paper-meta" style="display:block">${esc(g.funder)}</span>
        <span class="paper-meta" style="display:block;margin-top:.2rem">${team(g.team)}</span>
        <span class="badges"><span class="badge ${g.role === 'Lead' ? 'badge-solid' : g.role === 'Chief Investigator' ? 'badge-rank' : ''}" style="${g.role === 'Co-investigator' ? 'border-color:var(--navy);color:var(--navy);font-weight:600' : ''}">${esc(ROLE_LABEL[g.role])}</span>${g.related ? `<span class="badge">${g.related_url ? `<a href="${esc(g.related_url)}">${esc(g.related)}</a>` : esc(g.related)}</span>` : ''}</span></span>
      <span style="flex:0 0 auto;font-weight:600;white-space:nowrap">${esc(g.amount)}</span></li>`;
    const cur = F.filter((g) => g.end >= NOW), prev = F.filter((g) => g.end < NOW);
    $('grant-list').innerHTML = [['Current', cur], ['Previous', prev]].filter(([, xs]) => xs.length)
      .map(([l, xs]) => `<h3 class="group-h"><span>${l}</span><span>${plural(xs.length, 'project')}</span></h3><ol style="list-style:none;margin:0;padding:0">${xs.map(card).join('')}</ol>`).join('') || '<p class="empty">No grants match these filters.</p>';
  }
  function wire() {
    delegate($('main'), 'click', {
      src: (el) => { S.src = el.dataset.k; render(); const b = $('src-chips').querySelector(`[data-k="${CSS.escape(S.src)}"]`); if (b) b.focus(); },
      sel: (el) => { const i = +el.dataset.i; S.sel = S.sel === i ? null : i; render(); const b = $('timeline').querySelector(`[data-i="${i}"]`); if (b) b.focus(); },
    });
    $('f-role').addEventListener('change', (e) => { S.role = e.target.value; render(); });
  }
})();
