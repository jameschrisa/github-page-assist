import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installDOMParserStub } from './helpers/dom-stub.js';

installDOMParserStub();

const { analyzeProject } = await import('../js/analyze.js');
const { MAX_FILE_BYTES } = await import('../js/files.js');

function htmlFile(html, name = 'index.html') {
  return new File([html], name, { type: 'text/html' });
}

function sized(path, size) {
  // Lightweight stand-in for non-index entries: analyzeProject only reads
  // .size off these, never .slice()/.text(), so a plain object is enough.
  return { path, file: { size } };
}

function itemById(result, id) {
  return result.items.find((i) => i.id === id);
}

describe('index.html presence', () => {
  test('missing index.html anywhere => index item fails', async () => {
    const entries = [sized('style.css', 100)];
    const result = await analyzeProject(entries);
    const index = itemById(result, 'index');
    assert.equal(index.state, 'fail');
    assert.match(index.detail, /No index\.html in this folder/);
    assert.equal(result.score.ready, false);
  });

  test('index.html only nested (e.g. dist/index.html) reports the deep path', async () => {
    const entries = [sized('dist/index.html', 100), sized('dist/style.css', 50)];
    const result = await analyzeProject(entries);
    const index = itemById(result, 'index');
    assert.equal(index.state, 'fail');
    assert.match(index.detail, /index\.html found in \/dist, not the root/);
  });

  test('index.html at root passes', async () => {
    const entries = [{ path: 'index.html', file: htmlFile('<html><head><title>Hi</title></head></html>') }];
    const result = await analyzeProject(entries);
    const index = itemById(result, 'index');
    assert.equal(index.state, 'pass');
    assert.equal(result.score.ready, true);
  });
});

describe('file size checks', () => {
  test('a file over 100MB fails the filesize item', async () => {
    const entries = [
      { path: 'index.html', file: htmlFile('<html></html>') },
      sized('huge.bin', MAX_FILE_BYTES + 1),
    ];
    const result = await analyzeProject(entries);
    const item = itemById(result, 'filesize');
    assert.equal(item.state, 'fail');
    assert.match(item.detail, /Over 100 MB/);
    assert.match(item.detail, /huge\.bin/);
  });

  test('a file between 25MB and 100MB warns', async () => {
    const entries = [
      { path: 'index.html', file: htmlFile('<html></html>') },
      sized('medium.bin', 30 * 1024 * 1024),
    ];
    const result = await analyzeProject(entries);
    const item = itemById(result, 'filesize');
    assert.equal(item.state, 'warn');
    assert.match(item.detail, /medium\.bin is 30\.0 MB/);
  });

  test('files under 25MB pass cleanly', async () => {
    const entries = [
      { path: 'index.html', file: htmlFile('<html></html>') },
      sized('small.bin', 1024),
    ];
    const result = await analyzeProject(entries);
    assert.equal(itemById(result, 'filesize').state, 'pass');
  });

  test('total project size over 1GB fails even with no single large file', async () => {
    // Each file individually stays under the 100MB per-file cap; only the sum trips the 1GB cap.
    const entries = [
      { path: 'index.html', file: htmlFile('<html></html>') },
      ...Array.from({ length: 20 }, (_, i) => sized(`chunk-${i}.bin`, 60 * 1024 * 1024)),
    ];
    const result = await analyzeProject(entries);
    const item = itemById(result, 'filesize');
    assert.equal(item.state, 'fail');
    assert.match(item.detail, /must stay under 1 GB/);
  });
});

describe('warn items and their auto-fix generators', () => {
  test('.nojekyll missing => warn, fix generates empty file', async () => {
    const entries = [{ path: 'index.html', file: htmlFile('<html></html>') }];
    const result = await analyzeProject(entries);
    const item = itemById(result, 'nojekyll');
    assert.equal(item.state, 'warn');
    assert.equal(item.fix.path, '.nojekyll');
    assert.equal(item.fix.generate(), '');
  });

  test('.nojekyll present => pass, no fix needed reported as present', async () => {
    const entries = [
      { path: 'index.html', file: htmlFile('<html></html>') },
      sized('.nojekyll', 0),
    ];
    const result = await analyzeProject(entries);
    assert.equal(itemById(result, 'nojekyll').state, 'pass');
  });

  test('404.html missing => warn; generate() escapes the site title', async () => {
    const entries = [
      { path: 'index.html', file: htmlFile('<html><head><title>My <Site> & Co</title></head></html>') },
    ];
    const result = await analyzeProject(entries);
    const item = itemById(result, 'notfound');
    assert.equal(item.state, 'warn');
    const html = item.fix.generate();
    assert.match(html, /<title>Page not found · My &lt;Site&gt; &amp; Co<\/title>/);
    assert.match(html, /That page doesn't exist on My &lt;Site&gt; &amp; Co\./);
    assert.doesNotMatch(html, /<Site>/); // raw unescaped title must not leak through
  });

  test('robots.txt missing => warn; generate() includes Sitemap line only when canonicalUrl given', async () => {
    const entries = [{ path: 'index.html', file: htmlFile('<html></html>') }];
    const result = await analyzeProject(entries);
    const item = itemById(result, 'robots');
    assert.equal(item.state, 'warn');
    assert.equal(item.fix.generate(), 'User-agent: *\nAllow: /\n');

    const resultWithUrl = await analyzeProject(entries, { canonicalUrl: 'https://example.github.io/site/' });
    const itemWithUrl = itemById(resultWithUrl, 'robots');
    assert.equal(
      itemWithUrl.fix.generate(),
      'User-agent: *\nAllow: /\nSitemap: https://example.github.io/site/sitemap.xml\n'
    );
  });

  test('sitemap.xml missing => warn; generate() produces valid XML with expected <loc> entries', async () => {
    const entries = [
      { path: 'index.html', file: htmlFile('<html></html>') },
      sized('about/index.html', 10),
      sized('contact.html', 10),
      sized('404.html', 10), // must be excluded from the sitemap
    ];
    const result = await analyzeProject(entries, { canonicalUrl: 'https://example.github.io/site/' });
    const item = itemById(result, 'sitemap');
    assert.equal(item.state, 'warn');
    const xml = item.fix.generate();

    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    assert.match(xml, /<loc>https:\/\/example\.github\.io\/site\/<\/loc>/); // index.html => base root
    assert.match(xml, /<loc>https:\/\/example\.github\.io\/site\/about\/<\/loc>/);
    assert.match(xml, /<loc>https:\/\/example\.github\.io\/site\/contact\.html<\/loc>/);
    assert.doesNotMatch(xml, /404\.html/);

    // Balanced tags => well-formed enough to be parseable XML.
    const openCount = (xml.match(/<url>/g) || []).length;
    const closeCount = (xml.match(/<\/url>/g) || []).length;
    assert.equal(openCount, 3);
    assert.equal(closeCount, 3);
  });

  test('sitemap.xml present => pass', async () => {
    const entries = [
      { path: 'index.html', file: htmlFile('<html></html>') },
      sized('sitemap.xml', 100),
    ];
    const result = await analyzeProject(entries);
    assert.equal(itemById(result, 'sitemap').state, 'pass');
  });
});

describe('meta tag detection via DOMParser stub', () => {
  test('missing index.html fails description/og/canonical items', async () => {
    const entries = [sized('style.css', 10)];
    const result = await analyzeProject(entries);
    assert.equal(itemById(result, 'meta-description').state, 'fail');
    assert.equal(itemById(result, 'og').state, 'fail');
    assert.equal(itemById(result, 'canonical-tag').state, 'fail');
  });

  test('detects meta description, og tags, and canonical link when present', async () => {
    const html = `<!doctype html>
<html lang="en">
<head>
<meta name="description" content="A great site about things.">
<meta property="og:title" content="My Site">
<meta property="og:image" content="https://example.com/og.png">
<link rel="canonical" href="https://example.github.io/site/">
</head>
</html>`;
    const entries = [{ path: 'index.html', file: htmlFile(html) }];
    const result = await analyzeProject(entries);

    const desc = itemById(result, 'meta-description');
    assert.equal(desc.state, 'pass');
    assert.match(desc.detail, /A great site about things\./);

    const og = itemById(result, 'og');
    assert.equal(og.state, 'pass');
    assert.match(og.detail, /og:title "My Site" with og:image/);

    const canonical = itemById(result, 'canonical-tag');
    assert.equal(canonical.state, 'pass');
    assert.equal(canonical.detail, 'https://example.github.io/site/');

    assert.equal(result.head.lang, 'en');
  });

  test('warns with actionable messages when meta tags are absent', async () => {
    const entries = [{ path: 'index.html', file: htmlFile('<html><head></head></html>') }];
    const result = await analyzeProject(entries, { canonicalUrl: 'https://example.github.io/site/' });

    assert.equal(itemById(result, 'meta-description').state, 'warn');
    assert.equal(itemById(result, 'og').state, 'warn');

    const canonical = itemById(result, 'canonical-tag');
    assert.equal(canonical.state, 'warn');
    assert.match(canonical.detail, /Add <link rel="canonical" href="https:\/\/example\.github\.io\/site\/">/);
  });
});

describe('package.json without index.html', () => {
  test('adds a fail item warning that this looks like unbuilt source', async () => {
    const entries = [sized('package.json', 200), sized('src/main.js', 100)];
    const result = await analyzeProject(entries);
    const built = itemById(result, 'built');
    assert.ok(built, 'expected a "built" item to be added');
    assert.equal(built.state, 'fail');
  });

  test('does not add the item when index.html is present alongside package.json', async () => {
    const entries = [
      { path: 'index.html', file: htmlFile('<html></html>') },
      sized('package.json', 200),
    ];
    const result = await analyzeProject(entries);
    assert.equal(itemById(result, 'built'), undefined);
  });
});

describe('CNAME and favicon', () => {
  test('CNAME present adds a pass-only item', async () => {
    const entries = [
      { path: 'index.html', file: htmlFile('<html></html>') },
      sized('CNAME', 20),
    ];
    const result = await analyzeProject(entries);
    const cname = itemById(result, 'cname');
    assert.ok(cname);
    assert.equal(cname.state, 'pass');
  });

  test('CNAME absent adds no item at all', async () => {
    const entries = [{ path: 'index.html', file: htmlFile('<html></html>') }];
    const result = await analyzeProject(entries);
    assert.equal(itemById(result, 'cname'), undefined);
  });

  test('favicon.ico / .svg / .png at root is detected', async () => {
    for (const name of ['favicon.ico', 'favicon.svg', 'favicon.png']) {
      const entries = [
        { path: 'index.html', file: htmlFile('<html></html>') },
        sized(name, 100),
      ];
      const result = await analyzeProject(entries);
      assert.equal(itemById(result, 'favicon').state, 'pass', `expected ${name} to satisfy favicon check`);
    }
  });

  test('favicon nested in a subfolder does not count', async () => {
    const entries = [
      { path: 'index.html', file: htmlFile('<html></html>') },
      sized('assets/favicon.ico', 100),
    ];
    const result = await analyzeProject(entries);
    assert.equal(itemById(result, 'favicon').state, 'warn');
  });
});

describe('score()', () => {
  test('ready is false whenever any item fails, regardless of warn count', async () => {
    const entries = [sized('style.css', 10)]; // no index.html => fail
    const result = await analyzeProject(entries);
    assert.ok(result.score.fails >= 1);
    assert.equal(result.score.ready, false);
  });
});
