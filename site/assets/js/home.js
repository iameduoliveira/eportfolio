/* Home page: hero, headline numbers, about, theme cards and highlights. */
(function () {
  const { esc, load, fail } = window.EO;
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

    // headline numbers + citations sparkline (2015 onwards)
    const H = R.headline, now = new Date().getFullYear();
    const years = Object.keys(R.cby).filter((y) => +y >= 2015).sort();
    const max = Math.max(1, ...years.map((y) => R.cby[y]));
    const stat = (v, l) => `<a href="research.html" style="text-decoration:none;color:inherit"><div class="stat-v">${esc(v)}</div><div class="stat-l">${esc(l)}</div></a>`;
    const first = years[0], last = years[years.length - 1];
    document.getElementById('home-stats').innerHTML =
      `<div style="display:flex;flex-wrap:wrap;gap:2.5rem;align-items:flex-end;justify-content:space-between">
        <div class="stats-grid" style="flex:1 1 520px;grid-template-columns:repeat(4,minmax(0,1fr))">
          ${stat(H.works, 'publications')}${stat(H.citations, 'citations')}${stat(H.h, 'h-index')}${stat(H.coauthors, 'co-authors')}
        </div>
        <figure style="margin:0;flex:0 1 340px">
          <div role="img" aria-label="Citations per year, from ${R.cby[first]} in ${first} to ${R.cby[last]} in ${last}${+last === now ? ' so far' : ''}" style="display:flex;align-items:flex-end;gap:5px;height:72px">
            ${years.map((y) => `<div title="${y}: ${R.cby[y]} citations" style="flex:1 1 0;height:${Math.max(4, Math.round(R.cby[y] / max * 72))}px;background:var(${+y === now ? '--navy-faint' : '--navy'});border-radius:3px 3px 0 0"></div>`).join('')}
          </div>
          <figcaption class="small muted" style="margin-top:.5rem;display:flex;justify-content:space-between"><span>Citations per year, ${first}–${last}</span><span>${+last === now ? last + ' to date' : ''}</span></figcaption>
        </figure>
      </div>
      <p class="small muted" style="margin:1.2rem 0 0">Source: Google Scholar and OpenAlex, updated monthly. Last update ${esc(fmtDate(R.scholar_fetched || R.generated_at))}. <a href="research.html">Explore my research →</a></p>`;

    // about
    document.getElementById('about').innerHTML = (P.about || []).map((p) => `<p style="margin:0 0 1em">${esc(p)}</p>`).join('');

    // theme cards, with live paper counts
    document.getElementById('theme-cards').innerHTML = R.themes.map(([code, label, long, desc]) => {
      const n = R.works.filter((w) => w.th.indexOf(code) >= 0).length;
      return `<a class="theme-card" href="research.html?theme=${esc(code)}"><span class="n">${n} papers</span><span class="t">${esc(long)}</span><span class="d">${esc(desc)}</span></a>`;
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

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  }
})();
