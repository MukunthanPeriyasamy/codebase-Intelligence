/** Repair only unquoted rounded-node labels with balanced nested parentheses.
 * Call only after the original flowchart fails validation. Other diagram syntax,
 * quoted strings, comments and compound node shapes are deliberately preserved.
 */
export function quoteNestedRoundLabels(source: string): string {
  if (!/^\s*(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/m.test(source)) return source;
  return source.split('\n').map(line => {
    let result = '';
    for (let i = 0; i < line.length;) {
      if (line.slice(i, i + 2) === '%%') return result + line.slice(i);
      if (line[i] === '"') {
        const end = line.indexOf('"', i + 1);
        if (end < 0) return result + line.slice(i);
        result += line.slice(i, end + 1); i = end + 1; continue;
      }
      const node = line.slice(i).match(/^([\w-]+)\((?![([{"])/);
      if (node && (i === 0 || /[\s;>&]/.test(line[i - 1]))) {
        const start = i + node[0].length;
        let end = start, depth = 1, nested = false;
        for (; end < line.length && depth; end++) {
          if (line[end] === '(') { depth++; nested = true; }
          if (line[end] === ')') depth--;
        }
        const label = line.slice(start, end - 1);
        if (!depth && nested && !/["\[\]{}|]/.test(label)) {
          result += `${node[1]}("${label}")`;
          i = end; continue;
        }
      }
      result += line[i++];
    }
    return result;
  }).join('\n');
}
