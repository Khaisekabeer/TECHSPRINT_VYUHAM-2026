import { Fragment } from 'react';

// How a quiz master marks code in a question:
//   *one line of code*        on its own line
//   *several lines            opening * at the start, closing * at the end; indentation is kept
//       of code*
//   *each line*               or a * in front of every line
//   What does *len(x)* do?    inside a sentence
type Part = { code: boolean; value: string };

export function parseQuestion(text: string): Part[] {
  const lines = text.split(/\r?\n/);
  const parts: Part[] = [];
  const add = (code: boolean, value: string) => {
    const last = parts[parts.length - 1];
    if (last && last.code === code) last.value += `\n${value}`;
    else parts.push({ code, value });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const body = line.trimStart().slice(1);
    if (!line.trimStart().startsWith('*') || !body.trim()) { add(false, line); continue; }
    if (body.trimEnd().endsWith('*') && body.trim().length > 1) { add(true, body.trimEnd().slice(0, -1)); continue; }
    const end = lines.findIndex((l, j) => j > i && l.trimEnd().endsWith('*'));
    if (end > 0 && !lines[end].trimStart().startsWith('*')) {
      add(true, [body, ...lines.slice(i + 1, end), lines[end].trimEnd().slice(0, -1)].join('\n'));
      i = end;
    } else if (body.includes('*')) add(false, line); // "*x* does what?": code inside a sentence
    else add(true, body);
  }
  return parts.filter(p => p.value.trim());
}

// Inline code: *x* inside a sentence.
function Prose({ text }: { text: string }) {
  return (
    <span className="q-prose">
      {text.trim().split(/\*([^*\n]+)\*/).map((piece, i) => (i % 2 ? <code key={i} className="q-inline-code">{piece}</code> : <Fragment key={i}>{piece}</Fragment>))}
    </span>
  );
}

export default function QuestionText({ text }: { text: string }) {
  return <>{parseQuestion(text).map((p, i) => (p.code ? <pre key={i} className="q-code">{p.value}</pre> : <Prose key={i} text={p.value} />))}</>;
}
