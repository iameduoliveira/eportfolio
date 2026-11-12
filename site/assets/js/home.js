/* Home page: hero, headline numbers, about, research journey and highlights. */
(function () {
  const { esc, load, fail, plural } = window.EO;
  Promise.all([load('profile'), load('research')]).then(([P, R]) => {
    // hero
    document.getElementById('hero').innerHTML =
      `<img src="${esc(P.photo)}" alt="${esc(P.photo_alt)}" width="320" height="320">
      <div class="text">
        <p class="kicker">${esc(P.position)}</p>
        <h1 id="hero-title">${esc(P.name)}</h1>
        <p class="tag">${esc(P.tagline)}</p>
        <p class="roles">${esc(P.roles)}</p>
        <div class="btn-row">
          <a class="btn-primary" href="mailto:${esc(P.email)}">Email me</a>
          ${(P.links || []).map((l) => `<a class="btn-ghost" href="${esc(l.url)}">${esc(l.label)}</a>`).join('')}
        </div>
      </div>`;

    // headline numbers (each links to the Research page)
    const H = R.headline;
    const stat = (v, l) => `<a href="research.html" style="text-decoration:none;color:inherit"><div class="stat-v">${esc(v)}</div><div class="stat-l">${esc(l)}</div></a>`;
    document.getElementById('home-stats').innerHTML =
      `<div class="stats-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        ${stat(H.works, 'publications')}${stat(H.citations, 'citations')}${stat(H.h, 'h-index')}${stat(H.coauthors, 'co-authors')}
      </div>`;

    // about
    document.getElementById('about').innerHTML = (P.about || []).map((p) => `<p style="margin:0 0 1em">${esc(p)}</p>`).join('');

    // research journey: chapters from profile.yaml, paper counts and most-cited paper from the publications
    const TH = {}; R.themes.forEach(([code, label]) => { TH[code] = label; });
    const notes = P.journey_notes || {}, NOWY = new Date().getFullYear();
    const MEDAL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="6"/><path d="M8.2 13.2 7 22l5-3 5 3-1.2-8.8"/></svg>';
    const BANK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><path d="M5 21V10"/><path d="M19 21V10"/><path d="M9 21v-7"/><path d="M15 21v-7"/><path d="M2 10 12 3l10 7"/></svg>';
    const panel = (cls, label, icon, rows) => rows && rows.length ? `<div class="era-panel ${cls}"><h4>${label}</h4><ul>${rows.map((r) =>
      `<li><span class="ic">${icon}</span><span><strong>${esc(r.title)}</strong><span class="muted">${esc(r.detail || '')}</span></span></li>`).join('')}</ul></div>` : '';
    document.getElementById('journey').innerHTML = (P.journey || []).map((c) => {
      const to = c.to || NOWY, inRange = R.works.filter((w) => w.y >= c.from && w.y <= to);
      const top = inRange.slice().sort((a, b) => b.c - a.c)[0];
      const note = top ? Object.keys(notes).find((k) => top.t.toLowerCase().startsWith(k.toLowerCase())) : null;
      const cited = top ? `<a href="${esc(top.href || top.gs || '#')}">${esc(top.t.split(':')[0])}</a> (${top.y}), ${plural(top.c, 'citation')}${note ? ': ' + esc(notes[note]) : ''}` : '';
      const tags = (c.themes || []).filter((t) => TH[t]).map((t) => `<a class="era-tag" href="research.html?theme=${esc(t)}">${esc(TH[t])}</a>`)
        .concat((c.tags || []).map((t) => `<span class="era-tag">${esc(t)}</span>`)).join('');
      return `<article class="era${c.to ? '' : ' now'}">
        <p class="era-when">${c.from}–${c.to || 'now'} · ${plural(inRange.length, 'paper')}</p>
        <h3>${esc(c.title)}</h3>
        <p class="era-sub">${esc(c.subtitle || '')}</p>
        <p class="era-text">${esc(c.text || '')}</p>
        <div class="era-tags">${tags}</div>
        <div class="era-foot">${panel('grants', 'Grants', BANK, c.grants)}${panel('awards', 'Awards', MEDAL, c.awards)}
          ${cited ? `<p class="era-cited"><span class="lbl">Most cited</span>${cited}</p>` : ''}</div>
      </article>`;
    }).join('');

    // highlights
    document.getElementById('highlights').innerHTML = (P.highlights || []).map((h) => {
      let body = '';
      if (h.title) body += h.url && !h.link_text ? `<strong style="font-weight:600"><a href="${esc(h.url)}">${esc(h.title)}</a></strong> ` : `<strong style="font-weight:600">${esc(h.title)}</strong> `;
      if (h.link_text) body += `<a href="${esc(h.url)}">${esc(h.link_text)}</a>`;
      if (h.text) body += `<span class="muted">${esc(h.text)}</span>`;
      return `<li class="hl"><span class="lab">${esc(h.label)}</span><span class="body">${body}</span></li>`;
    }).join('');
    const ml = P.media_line || [];
    if (ml.length) {
      const names = ml.map((m) => `<a href="${esc(m.url)}">${esc(m.label)}</a>`);
      const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
      document.getElementById('media').innerHTML = `My work has featured in ${list}. <a href="talks.html">Projects, talks and media →</a>`;
    }
  }).catch((e) => fail(document.getElementById('home-stats'), e));

})();
