/* Teaching page: headline numbers, subjects-by-year grid, details, supervision, leadership, workshops, qualifications. */
(function () {
  const { esc, load, fail, plural, delegate } = window.EO;
  const $ = (id) => document.getElementById(id);
  const S = { sel: 0 };
  let T, YEARS;
  const span = (ys) => { if (!ys.length) return 'No'; const n = ys.map(Number).sort((a, b) => a - b), out = []; let s = n[0], p = n[0];
    for (let i = 1; i <= n.length; i++) { if (n[i] === p + 1) { p = n[i]; continue; } out.push(s === p ? String(s) : s + '–' + String(p).slice(2)); s = n[i]; p = n[i]; } return out.join(', '); };
  const AWARD_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="6"/><path d="M8.2 13.2 7 22l5-3 5 3-1.2-8.8"/></svg>';

  load('teaching').then((d) => {
    T = d;
    const all = T.subjects.flatMap((s) => (s.coordinator || []).concat(s.teaching_team || []));
    const y0 = Math.min(...all), y1 = Math.max(...all); YEARS = []; for (let y = y0; y <= y1; y++) YEARS.push(y);
    const first = T.subjects[0], coordYears = (first.coordinator || []).length;
    $('kpis').innerHTML = [[YEARS.length, `years teaching at Melbourne (${y0}–${y1})`], [T.subjects.length, 'subjects and microcredentials'], [coordYears, 'years coordinating ' + first.name],
      [(T.supervision.find((s) => /capstone/i.test(s.text)) || {}).number || '', "Master's capstone students supervised"], [Object.keys(T.awards || {}).length, 'teaching awards and fellowships']]
      .map(([v, l]) => `<div><div class="stat-v">${esc(v)}</div><div class="stat-l">${esc(l)}</div></div>`).join('');
    $('supervision').innerHTML = T.supervision.map((s) => `<li style="display:flex;gap:1rem;padding:.9rem 0"><span style="flex:0 0 3rem;font-size:1.5rem;font-weight:700;color:var(--navy);line-height:1.1">${esc(s.number)}</span><span style="font-size:.92rem">${esc(s.text)}</span></li>`).join('');
    $('leadership').innerHTML = T.leadership.map((l) => `<li style="display:flex;gap:1rem;padding:.55rem 0;font-size:.9rem"><span class="muted" style="flex:0 0 4.5rem">${esc(l.years)}</span><span>${esc(l.role)}</span></li>`).join('');
    $('beyond').innerHTML = T.beyond.map((b) => `<div class="card"><p style="margin:0 0 .3rem;font-size:.82rem;font-weight:600;color:var(--navy)">${esc(b.year)}</p><p style="margin:0 0 .4rem;font-weight:600;font-size:1.02rem">${esc(b.title)}</p><p class="muted" style="margin:0;font-size:.88rem">${esc(b.text)}</p></div>`).join('');
    $('quals').innerHTML = T.qualifications.map((q) => `<li style="display:flex;gap:1rem;padding:.6rem 0;font-size:.92rem"><span class="muted" style="flex:0 0 4.5rem">${esc(q.year)}</span><span>${esc(q.title)}</span></li>`).join('');
    $('earlier').textContent = T.earlier || '';
    wire(); render();
  }).catch((e) => fail($('kpis'), e));

  function render() {
    const awards = T.awards || {};
    const head = '<caption class="vh">Subjects taught at the University of Melbourne by year, showing coordinator years</caption><thead>' +
      '<tr><td style="border-top:none"></td>' + YEARS.map((y) => `<td style="text-align:center;height:34px;border-top:none">${awards[y] ? `<a href="awards.html" data-lab="${esc(y + ': ' + awards[y])}" aria-label="${esc(y + ': ' + awards[y])}" style="display:inline-flex;width:32px;height:32px;align-items:center;justify-content:center;border-radius:50%;background:var(--teach-bg);color:var(--teach-fg)">${AWARD_ICON}</a>` : ''}</td>`).join('') + '</tr>' +
      '<tr><th scope="col" style="text-align:left">Subject</th>' + YEARS.map((y) => `<th scope="col">'${String(y).slice(2)}</th>`).join('') + '</tr></thead>';
    const body = '<tbody>' + T.subjects.map((s, i) => { const on = S.sel === i, c = new Set(s.coordinator || []), t = new Set(s.teaching_team || []);
      return `<tr style="background:${on ? 'var(--hover)' : 'transparent'}"><th scope="row" style="font-weight:400"><button type="button" class="subj" data-act="subj" data-i="${i}" aria-pressed="${on}"><span class="code">${esc(s.code)}</span><span class="name" style="font-weight:${on ? 700 : 500}">${esc(s.name)}</span></button></th>` +
        YEARS.map((y) => { const r = c.has(y) ? 'coordinator' : t.has(y) ? 'teaching team' : null; if (!r) return '<td></td>';
          const lab = `${s.code} ${s.name}, ${y}: ${r}`; return `<td><span class="sq ${r === 'coordinator' ? 'sq-c' : 'sq-t'}" role="img" aria-label="${esc(lab)}" data-lab="${esc(lab)}"></span></td>`; }).join('') + '</tr>'; }).join('') + '</tbody>';
    $('subject-grid').innerHTML = head + body;
    const s = T.subjects[S.sel];
    if (!s) { $('subject-details').innerHTML = '<p class="empty" style="margin:0">Select a subject to see the years I taught and coordinated it.</p>'; return; }
    const taught = (s.coordinator || []).concat(s.teaching_team || []), handbook = /^[A-Z]{4}\d{5}$/.test(s.code);
    $('subject-details').innerHTML = `<div class="card"><p style="margin:0;font-size:.8rem;font-weight:700;color:var(--navy);letter-spacing:.02em">${esc(s.code)}</p>
      <p style="margin:.15rem 0 .7rem;font-weight:600;font-size:1.1rem;line-height:1.3">${esc(s.name)}</p>
      <dl class="meta"><dt>Taught</dt><dd>${span(taught)}</dd><dt>Coordinator</dt><dd>${span(s.coordinator || [])}</dd></dl>
      ${s.note ? `<p style="margin:.8rem 0 0;font-size:.88rem">${esc(s.note)}</p>` : ''}
      ${handbook ? `<p style="margin:.8rem 0 0;font-size:.88rem"><a href="https://handbook.unimelb.edu.au/subjects/${esc(s.code.toLowerCase())}">Handbook entry →</a></p>` : ''}</div>`;
  }
  function wire() {
    delegate($('main'), 'click', { subj: (el) => { const i = +el.dataset.i; S.sel = S.sel === i ? null : i; render(); const b = $('subject-grid').querySelector(`[data-i="${i}"]`); if (b) b.focus(); } });
    const ro = (e) => { const b = e.target.closest('[data-lab]'); $('readout').textContent = b ? b.dataset.lab : 'Hover over a square or an award.'; };
    $('subject-grid').addEventListener('mouseover', ro); $('subject-grid').addEventListener('focusin', ro);
  }
})();
