// Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF, BOM, and
// comma / semicolon / tab delimiters (Excel exports vary by locale).
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.indexOf('\n') === -1 ? src.length : src.indexOf('\n'));
  const delimiter = [',', ';', '\t'].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best, ',');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

export type Field = 'ticketId' | 'name' | 'email' | 'phone' | 'college';

const GUESSES: Record<Field, RegExp> = {
  ticketId: /ticket|booking|pass|reg(istration)?[\s_-]*(id|no|number)|^id$|code/i,
  name: /^(full[\s_-]*)?name$|participant|attendee|^name\b/i,
  email: /e-?mail/i,
  phone: /phone|mobile|contact|whats\s?app/i,
  college: /college|institut|organi[sz]ation|school|university|company/i,
};

// Guess which column holds which field from the header row.
export function guessColumns(headers: string[]): Record<Field, number> {
  const used = new Set<number>();
  const pick = (field: Field) => {
    const i = headers.findIndex((h, idx) => !used.has(idx) && GUESSES[field].test(h.trim()));
    if (i >= 0) used.add(i);
    return i;
  };
  // Order matters: specific fields first so "Name" doesn't swallow "College Name".
  const ticketId = pick('ticketId');
  const email = pick('email');
  const phone = pick('phone');
  const college = pick('college');
  const name = pick('name');
  return { ticketId, name, email, phone, college };
}
