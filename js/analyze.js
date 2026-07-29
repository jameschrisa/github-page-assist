// Project analysis: inspects the selected files and produces the readiness
// checklist. Items with a `fix` can auto-generate the missing file, which is
// merged into the upload set at deploy time.

import { MAX_FILE_BYTES, MAX_TOTAL_BYTES, formatBytes } from './files.js';

export async function analyzeProject(entries, ctx = {}) {
  const paths = new Set(entries.map((e) => e.path));
  const totalBytes = entries.reduce((n, e) => n + e.file.size, 0);
  const has = (p) => paths.has(p);

  const indexEntry = entries.find((e) => e.path === 'index.html');
  let head = null;
  if (indexEntry) head = parseHead(await readText(indexEntry.file));

  const tooBig = entries.filter((e) => e.file.size > MAX_FILE_BYTES);
  const siteTitle = head?.title || ctx.repoName || '';

  const items = [];
  const add = (item) => items.push(item);

  const deepIndex = !indexEntry && entries.find((e) => e.path.endsWith('/index.html'));
  add({
    id: 'index',
    label: 'index.html at project root',
    state: indexEntry ? 'pass' : 'fail',
    detail: indexEntry
      ? 'Found at project root.'
      : deepIndex
        ? `index.html found in /${deepIndex.path.slice(0, -'/index.html'.length)}, not the root. Deploy the folder that contains index.html.`
        : 'No index.html in this folder. GitHub Pages needs one at the root to serve your site. If this is a framework project, deploy its build output (usually dist/ or build/), not the source.',
    why: 'Pages serves index.html as your homepage. Without it, visitors see a 404.',
  });

  const heavy = entries.filter((e) => e.file.size > 25 * 1024 * 1024 && e.file.size <= MAX_FILE_BYTES);
  add({
    id: 'filesize',
    label: 'All files within GitHub limits',
    state: tooBig.length || totalBytes > MAX_TOTAL_BYTES ? 'fail' : heavy.length ? 'warn' : 'pass',
    detail: tooBig.length
      ? `Over 100 MB (GitHub rejects these): ${tooBig.map((e) => e.path).join(', ')}`
      : totalBytes > MAX_TOTAL_BYTES
        ? `Project is ${formatBytes(totalBytes)} — Pages sites must stay under 1 GB.`
        : heavy.length
          ? `${heavy.map((e) => `${e.path} is ${formatBytes(e.file.size)}`).join('; ')}. Large files upload slowly and weigh down your site.`
          : `${entries.length} files, ${formatBytes(totalBytes)} total. Limits: 100 MB per file, 1 GB per site.`,
    why: 'GitHub blocks files over 100 MB and Pages sites over 1 GB.',
  });

  add({
    id: 'nojekyll',
    label: '.nojekyll file',
    state: has('.nojekyll') ? 'pass' : 'warn',
    detail: has('.nojekyll')
      ? 'Present — Pages will serve your files exactly as uploaded.'
      : 'Missing. Without it, GitHub runs Jekyll on your files and silently drops anything starting with an underscore (common in Vite/Next output).',
    why: 'Skips Jekyll processing so folders like _app/ or _next/ are not ignored.',
    fix: { path: '.nojekyll', generate: () => '' },
  });

  add({
    id: 'notfound',
    label: 'Custom 404.html page',
    state: has('404.html') ? 'pass' : 'warn',
    detail: has('404.html')
      ? 'Present — broken links show your page instead of the GitHub default.'
      : 'Missing. Visitors who hit a bad link will see the generic GitHub 404.',
    why: 'A branded 404 keeps visitors on your site; SPAs also use it for client-side routing fallbacks.',
    fix: { path: '404.html', generate: () => generate404(siteTitle) },
  });

  const description = head?.description;
  add({
    id: 'meta-description',
    label: 'Meta description',
    state: !indexEntry ? 'fail' : description ? 'pass' : 'warn',
    detail: !indexEntry
      ? 'No index.html to check.'
      : description
        ? `"${truncate(description, 120)}"`
        : 'index.html has no <meta name="description">. Search engines will improvise a snippet.',
    why: 'The description is the text under your link in search results.',
  });

  add({
    id: 'og',
    label: 'Open Graph / social tags',
    state: !indexEntry ? 'fail' : head?.ogTitle ? 'pass' : 'warn',
    detail: !indexEntry
      ? 'No index.html to check.'
      : head?.ogTitle
        ? `og:title "${truncate(head.ogTitle, 80)}"${head.ogImage ? ' with og:image' : ' (no og:image)'}`
        : 'No og:title / og:image tags. Links shared on Slack, X, or LinkedIn will render as bare URLs.',
    why: 'Open Graph tags control the preview card when your link is shared.',
  });

  add({
    id: 'canonical-tag',
    label: 'Canonical <link> tag',
    state: !indexEntry ? 'fail' : head?.canonical ? 'pass' : 'warn',
    detail: !indexEntry
      ? 'No index.html to check.'
      : head?.canonical
        ? head.canonical
        : ctx.canonicalUrl
          ? `Missing. Add <link rel="canonical" href="${ctx.canonicalUrl}"> to index.html.`
          : 'Missing. Add a canonical link tag pointing at your Pages URL once deployed.',
    why: 'Tells search engines the official URL, avoiding duplicate-content penalties.',
  });

  const hasFavicon = [...paths].some((p) => /^favicon\.(ico|svg|png)$/.test(p));
  add({
    id: 'favicon',
    label: 'Favicon',
    state: hasFavicon ? 'pass' : 'warn',
    detail: hasFavicon ? 'Found.' : 'No favicon.ico / favicon.svg at the root — browser tabs show a blank icon.',
    why: 'The little icon in browser tabs, bookmarks, and search results.',
  });

  add({
    id: 'robots',
    label: 'robots.txt',
    state: has('robots.txt') ? 'pass' : 'warn',
    detail: has('robots.txt') ? 'Present.' : 'Missing. Optional, but it makes crawler intent explicit and can point at a sitemap.',
    why: 'Tells search engine crawlers what they may index.',
    fix: {
      path: 'robots.txt',
      generate: () =>
        `User-agent: *\nAllow: /\n${ctx.canonicalUrl ? `Sitemap: ${ctx.canonicalUrl.replace(/\/$/, '')}/sitemap.xml\n` : ''}`,
    },
  });

  add({
    id: 'sitemap',
    label: 'sitemap.xml',
    state: has('sitemap.xml') ? 'pass' : 'warn',
    detail: has('sitemap.xml') ? 'Present.' : 'Missing. Helpful for multi-page sites; harmless to skip for one-pagers.',
    why: 'Helps search engines discover all your pages.',
    fix: {
      path: 'sitemap.xml',
      generate: () => generateSitemap(entries, ctx.canonicalUrl || ''),
    },
  });

  if (has('CNAME')) {
    add({
      id: 'cname',
      label: 'Custom domain (CNAME)',
      state: 'pass',
      detail: 'CNAME file present — GitHub will bind your custom domain on deploy.',
      why: 'The CNAME file configures a custom domain for GitHub Pages.',
    });
  }

  if (has('package.json') && !indexEntry) {
    add({
      id: 'built',
      label: 'Looks like unbuilt source code',
      state: 'fail',
      detail: 'Found package.json but no index.html. Run your build (npm run build) and deploy the output folder instead.',
      why: 'GitHub Pages serves static files only — it does not run build steps for you.',
    });
  }

  return {
    entries,
    totalBytes,
    fileCount: entries.length,
    head,
    items,
    score: score(items),
  };
}

function score(items) {
  const fails = items.filter((i) => i.state === 'fail').length;
  const warns = items.filter((i) => i.state === 'warn').length;
  return { fails, warns, ready: fails === 0 };
}

async function readText(file) {
  try {
    return await file.slice(0, 256 * 1024).text();
  } catch {
    return '';
  }
}

function parseHead(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = (sel, attr = 'content') => doc.querySelector(sel)?.getAttribute(attr) || '';
  return {
    title: doc.querySelector('title')?.textContent.trim() || '',
    description: meta('meta[name="description" i]'),
    ogTitle: meta('meta[property="og:title" i]'),
    ogImage: meta('meta[property="og:image" i]'),
    canonical: meta('link[rel="canonical" i]', 'href'),
    viewport: meta('meta[name="viewport" i]'),
    lang: doc.documentElement.getAttribute('lang') || '',
  };
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function generate404(title) {
  const t = esc(title || 'This site');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · ${t}</title>
<style>
  body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #0f1117; color: #e6e8ee; text-align: center; }
  main { padding: 2rem; }
  h1 { font-size: 4rem; margin: 0; }
  a { color: #7aa2ff; }
</style>
</head>
<body>
<main>
  <h1>404</h1>
  <p>That page doesn't exist on ${t}.</p>
  <p><a href="/">Back to the homepage</a></p>
</main>
</body>
</html>
`;
}

function generateSitemap(entries, baseUrl) {
  const base = baseUrl ? baseUrl.replace(/\/$/, '') : '';
  const pages = entries
    .filter((e) => e.path.endsWith('.html') && e.path !== '404.html')
    .map((e) => (e.path === 'index.html' ? '' : e.path.replace(/index\.html$/, '')));
  const urls = [...new Set(pages)]
    .map((p) => `  <url><loc>${esc(`${base}/${p}`)}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
