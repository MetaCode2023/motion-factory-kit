// tools/longform/xml.mjs: a minimal XML reader (no dependency) for the xmeml files editors write.
//
//   parseXML(text)      -> the document element { name, attrs, children, text }
//   kids(node, name)    -> the child elements called name;  kid(node, name) -> the first, or undefined
//   txt(node, name)     -> the trimmed text of the first child called name ('' when absent)
//   all(node, name)     -> every descendant called name, in document order
// Reads elements, attributes, text, the five named entities and numeric character references. Skips the XML
// declaration, DOCTYPE, comments and processing instructions; CDATA becomes text. No namespaces, no validation.
// Throws on a tag that is not closed or does not match.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : NAMED[e] ?? m));
const TAG = /<([^\s\/>]+)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTR = /([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseXML(src) {
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const skip = (from, end, what) => { const e = src.indexOf(end, from); if (e < 0) throw new Error(`${what} is not closed`); return e + end.length; };
  while (i < src.length) {
    const top = stack[stack.length - 1];
    const lt = src.indexOf('<', i);
    if (lt < 0) { top.text += decode(src.slice(i)); break; }
    if (lt > i) top.text += decode(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) i = skip(lt + 4, '-->', 'comment');
    else if (src.startsWith('<![CDATA[', lt)) { const e = skip(lt + 9, ']]>', 'CDATA'); top.text += src.slice(lt + 9, e - 3); i = e; }
    else if (src.startsWith('<?', lt)) i = skip(lt + 2, '?>', 'processing instruction');
    else if (src.startsWith('<!', lt)) {
      let depth = 0, j = lt + 2;
      for (; j < src.length && !(src[j] === '>' && depth === 0); j++) depth += src[j] === '[' ? 1 : src[j] === ']' ? -1 : 0;
      if (j >= src.length) throw new Error('DOCTYPE is not closed');
      i = j + 1;
    } else if (src.startsWith('</', lt)) {
      const e = src.indexOf('>', lt), name = src.slice(lt + 2, e < 0 ? undefined : e).trim();
      if (e < 0 || stack.length < 2 || top.name !== name) throw new Error(`mismatched closing tag </${name}> (expected </${top.name}>)`);
      stack.pop();
      i = e + 1;
    } else {
      TAG.lastIndex = lt;
      const m = TAG.exec(src);
      if (!m) throw new Error(`bad tag near "${src.slice(lt, lt + 30)}"`);
      const node = { name: m[1], attrs: {}, children: [], text: '' };
      for (const a of m[2].matchAll(ATTR)) node.attrs[a[1]] = decode(a[2] ?? a[3]);
      top.children.push(node);
      if (!m[3]) stack.push(node);
      i = TAG.lastIndex;
    }
  }
  if (stack.length > 1) throw new Error(`unclosed tag <${stack[stack.length - 1].name}>`);
  if (!root.children[0]) throw new Error('no element found');
  return root.children[0];
}

export const kids = (n, name) => n.children.filter((c) => c.name === name);
export const kid = (n, name) => n.children.find((c) => c.name === name);
export const txt = (n, name) => kid(n, name)?.text.trim() ?? '';
export function all(n, name) {
  const out = [];
  for (const c of n.children) { if (c.name === name) out.push(c); out.push(...all(c, name)); }
  return out;
}
