// Minimal regex-based stand-in for DOMParser, just enough to support the
// exact querySelector calls js/analyze.js's parseHead() makes:
//   doc.querySelector('title')
//   doc.querySelector('meta[name="description" i]')
//   doc.querySelector('meta[property="og:title" i]')
//   doc.querySelector('meta[property="og:image" i]')
//   doc.querySelector('link[rel="canonical" i]')
//   doc.querySelector('meta[name="viewport" i]')
//   doc.documentElement.getAttribute('lang')
//
// It is NOT a general HTML parser. It only understands <html>, <title>,
// <meta>, and <link> tags, which is all analyze.js touches.

function extractAttrs(tagInnerStr) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"|([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(tagInnerStr))) {
    if (m[1] !== undefined) attrs[m[1].toLowerCase()] = m[2];
    else attrs[m[3].toLowerCase()] = m[4];
  }
  return attrs;
}

function parseSimpleSelector(sel) {
  // Supports: tagname  OR  tagname[attr="value"]  OR  tagname[attr="value" i]
  const m = sel.match(/^([a-zA-Z]+)(?:\[([\w-]+)="([^"]+)"(\s+i)?\])?$/);
  if (!m) throw new Error(`Unsupported selector in dom-stub: ${sel}`);
  return { tag: m[1].toLowerCase(), attr: m[2], value: m[3], ci: !!m[4] };
}

function makeElement(tag, attrs, text) {
  return {
    tag,
    attrs,
    textContent: text ?? '',
    getAttribute(name) {
      const v = attrs[name.toLowerCase()];
      return v === undefined ? null : v;
    },
  };
}

function parseFromString(html) {
  const elements = [];

  const htmlTagMatch = html.match(/<html([^>]*)>/i);
  const htmlAttrs = htmlTagMatch ? extractAttrs(htmlTagMatch[1]) : {};

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) elements.push(makeElement('title', {}, titleMatch[1]));

  const metaRe = /<meta([^>]*)>/gi;
  let mm;
  while ((mm = metaRe.exec(html))) elements.push(makeElement('meta', extractAttrs(mm[1]), ''));

  const linkRe = /<link([^>]*)>/gi;
  let lm;
  while ((lm = linkRe.exec(html))) elements.push(makeElement('link', extractAttrs(lm[1]), ''));

  return {
    documentElement: makeElement('html', htmlAttrs, ''),
    querySelector(sel) {
      const parsed = parseSimpleSelector(sel);
      for (const el of elements) {
        if (el.tag !== parsed.tag) continue;
        if (parsed.attr) {
          const v = el.attrs[parsed.attr.toLowerCase()];
          if (v === undefined) continue;
          if (parsed.ci ? v.toLowerCase() !== parsed.value.toLowerCase() : v !== parsed.value) continue;
        }
        return el;
      }
      return null;
    },
  };
}

export function installDOMParserStub() {
  globalThis.DOMParser = class DOMParser {
    parseFromString(html) {
      return parseFromString(html);
    }
  };
}
