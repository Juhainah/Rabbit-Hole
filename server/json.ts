// LLMs love to wrap JSON in prose and fences, forget to escape quotes, leave
// trailing commas, or get cut off mid-object. This digs the JSON out and repairs it.

export function stripThinking(text: string): string {
  // Reasoning models wrap their working in <think> (or Gemma's <thought>) tags; only the answer counts.
  return text.replace(/<(think|thought)>[\s\S]*?<\/(think|thought)>/gi, '').replace(/^[\s\S]*?<\/(think|thought)>/i, '');
}

/**
 * Walks the text once, escaping quotes that can't be closing quotes, turning raw
 * newlines inside strings into \n, and closing any strings/brackets left open by
 * a truncated reply.
 */
export function repairJson(src: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) {
        out += ch;
        esc = false;
      } else if (ch === '\\') {
        out += ch;
        esc = true;
      } else if (ch === '"') {
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j])) j++;
        const next = src[j];
        if (next === undefined || next === ',' || next === '}' || next === ']' || next === ':') {
          inStr = false;
          out += ch;
        } else {
          out += '\\"';
        }
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r' || ch === '\t') {
        out += ' ';
      } else {
        out += ch;
      }
      continue;
    }
    // A value that should be a string but lost its opening quote: "key": U.S. Army,
    if (/[A-Za-z]/.test(ch) && /:\s*$/.test(out) && !/^(true|false|null)\b/.test(src.slice(i, i + 5))) {
      let j = i;
      while (j < src.length && src[j] !== '\n' && !/^,\s*"/.test(src.slice(j)) && !/^\s*[}\]]/.test(src.slice(j))) j++;
      out += `"${src.slice(i, j).replace(/[\s,]+$/, '').replace(/"/g, '\\"')}"`;
      i = j - 1;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
    out += ch;
  }
  if (inStr) out += '"';
  // A reply cut off mid-pair leaves `, "key"` or `, "key":` dangling.
  out = out.replace(/,\s*$/, '').replace(/,\s*"[^"]*"\s*:?\s*$/, '').replace(/:\s*$/, ': null');
  while (stack.length) out += stack.pop();
  return out.replace(/,\s*([}\]])/g, '$1');
}

const normaliseQuotes = (s: string) =>
  s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^\s*\/\/.*$/gm, '');

export function parseJsonLoose<T = unknown>(raw: string): T {
  let text = stripThinking(raw).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  if (fence && fence[1].includes('{')) text = fence[1];
  const start = text.indexOf('{');
  if (start < 0) throw new Error('model did not return JSON');
  const end = text.lastIndexOf('}');
  const candidates = [
    end > start ? text.slice(start, end + 1) : '',
    end > start ? repairJson(normaliseQuotes(text.slice(start, end + 1))) : '',
    repairJson(normaliseQuotes(text.slice(start))),
  ].filter(Boolean);
  let lastErr: unknown;
  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('invalid JSON');
}
