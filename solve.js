// A fast drop-in for make.fun's csv-reader 1.0.0.
//
// run(input) returns exactly what csv-reader 1.0.0 returns for the same
// {text, header}: {columns, rows, errors}. The reading policy, in short:
// a U+FEFF at the very start is dropped; a record ends at LF or CRLF and a
// line left with no characters is no record; outside quotes a CR not followed
// by LF is dropped (error stray_cr); a field that opens with a quote runs to
// the next quote that is not doubled, "" inside it is one quote and each CRLF
// or lone CR inside it reads as LF; what follows its closing quote, up to the
// next comma or line break, is appended as it stands (quote_junk, when the
// field ends); a quote that never closes is a literal character and the text
// after it is read again as unquoted (unterminated_quote); a quote inside an
// unquoted field is a literal character; fields stay strings, never trimmed
// or converted; columns is the first record when header is true, else null;
// rows holds the records after it, each padded with "" (short_row, with
// fields: its field count) or cut (long_row, with extra: the cut fields) to
// the first record's width; each error is {code, line, row} in the order met,
// line the 1-based line its record starts on, row its record's index in rows
// (null for the header).
//
// How it is fast: the reference reads one character at a time and builds
// every field a character at a time. This reader jumps instead. An unquoted
// field is found with one regex match over its terminator (comma, CR, LF or
// CRLF), so the whole field is one slice. A quoted field jumps from quote to
// quote with indexOf, and a chunk between quotes is one slice unless it holds
// a line break, in which case only that chunk takes the slow path. No result
// object is built per field: the field scanners report through shared
// variables, and a field that is one chunk is assigned, never concatenated.

const TERM = /,|\r\n?|\n/g;
const HAS_BREAK = /[\r\n]/;

// A quoted chunk that holds a line break, read as the reference reads it:
// every CRLF and every lone CR becomes one LF. Reports through shared
// variables (no array built per chunk): the rewritten chunk and how many
// lines it spans, so the line count stays exact.
let normValue;
let normLines;
function normalizeChunk(chunk) {
  let out = '';
  let start = 0;
  let lines = 0;
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk.charCodeAt(i);
    if (c === 13) {
      out += chunk.slice(start, i) + '\n';
      lines++;
      if (chunk.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
    } else if (c === 10) {
      lines++;
    }
  }
  out += chunk.slice(start);
  normValue = out;
  normLines = lines;
}

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let line = 1;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null while the header is being read).
  let recordLine = 1;
  let recordRow = null;

  // What the field scanners found: the field's value, how it ended
  // (0 comma, 1 line break, 2 end of text) and, for an unquoted scan, how
  // many characters it kept (the quote_junk test reads this).
  let fieldValue;
  let fieldEnded;
  let fieldAdded;

  // Reads an unquoted field onto `value`: up to the next comma or line
  // break, a CR not followed by LF dropped (stray_cr). The first chunk is
  // assigned, later ones appended, so a plain field costs one slice.
  function readUnquoted(value) {
    let added = 0;
    let first = value === '';
    for (;;) {
      TERM.lastIndex = pos;
      const m = TERM.exec(text);
      if (m === null) {
        const chunk = text.slice(pos);
        value = first ? chunk : value + chunk;
        added += chunk.length;
        pos = n;
        fieldValue = value;
        fieldEnded = 2;
        fieldAdded = added;
        return;
      }
      const i = m.index;
      const term = m[0];
      const chunk = text.slice(pos, i);
      if (first) {
        value = chunk;
        first = false;
      } else {
        value += chunk;
      }
      added += chunk.length;
      if (term === ',') {
        pos = i + 1;
        fieldValue = value;
        fieldEnded = 0;
        fieldAdded = added;
        return;
      }
      if (term === '\r') {
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos = i + 1;
        continue;
      }
      pos = i + term.length;
      line++;
      fieldValue = value;
      fieldEnded = 1;
      fieldAdded = added;
      return;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let first = true;
    let p = pos + 1;
    for (;;) {
      const q = text.indexOf('"', p);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      const chunk = text.slice(p, q);
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, and the field goes on.
        let piece;
        if (!HAS_BREAK.test(chunk)) {
          piece = chunk + '"';
        } else {
          normalizeChunk(chunk);
          piece = normValue + '"';
          line += normLines;
        }
        if (first) {
          value = piece;
          first = false;
        } else {
          value += piece;
        }
        p = q + 2;
        continue;
      }
      // The closing quote.
      if (!HAS_BREAK.test(chunk)) {
        if (first) value = chunk;
        else value += chunk;
      } else {
        normalizeChunk(chunk);
        if (first) value = normValue;
        else value += normValue;
        line += normLines;
      }
      pos = q + 1;
      break;
    }
    if (pos >= n) {
      fieldValue = value;
      fieldEnded = 2;
      fieldAdded = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos++;
      fieldValue = value;
      fieldEnded = 0;
      fieldAdded = 0;
      return;
    }
    if (c === 10) {
      pos++;
      line++;
      fieldValue = value;
      fieldEnded = 1;
      fieldAdded = 0;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line++;
      fieldValue = value;
      fieldEnded = 1;
      fieldAdded = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    readUnquoted(value);
    if (fieldAdded > 0) {
      errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quotedLast = false;
    do {
      quotedLast = text.charCodeAt(pos) === 34;
      if (quotedLast) readQuoted();
      else readUnquoted('');
      fields.push(fieldValue);
    } while (fieldEnded === 0);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quotedLast) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
