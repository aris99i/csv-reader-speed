// A fast drop-in for make.fun's csv-reader 1.0.0, second attempt, revised.
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
// How it is fast: the reference reads one character at a time, and the first
// attempt still paid a regular expression per field. This reader pays none:
// an unquoted field is found with two indexOf calls (comma, line feed),
// taking the nearer, and one small indexOf over the field itself for a CR.
// A quoted field jumps from quote to quote with indexOf, and a chunk between
// quotes is one slice unless it holds a line break, in which case only that
// chunk takes the slow path. No result object is built per field: the field
// scanners report through shared variables, and a field that is one chunk is
// assigned, never concatenated. Dropping the two regular expressions also
// collapsed the garbage collector's share of the run from about a fifth to
// about a fiftieth. Measured on the practice set (median of 9 interleaved
// rounds, --no-incremental-marking): reference about 400 ms, first attempt
// about 130 ms, this reader about 90 ms — roughly 4.5x the reference and
// 1.5x the first attempt.

/** A quoted chunk that holds a line break, read as the reference reads it:
 * every CRLF and every lone CR becomes one LF. Reports through shared
 * variables (no array built per chunk): the rewritten chunk and how many
 * lines it spans, so the line count stays exact. A chunk whose breaks are
 * only line feeds needs no rewriting, so it is handed back as it stands. */
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
  normValue = out === '' ? chunk : out + chunk.slice(start);
  normLines = lines;
}

/**
 * The answer for one case's input.
 * @param {{text: string, header: boolean}} input
 * @returns {{columns: string[] | null, rows: string[][], errors: {code: string, line: number, row: number | null}[]}}
 */
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
  // break. A CR inside the field is either the first half of a CRLF line
  // break (only when it is the field's last character and a line feed
  // follows it) or a stray CR, dropped with an error. The scan finds the
  // nearest comma or line feed with two indexOf calls, so a plain field
  // costs one slice and no regular expression at all.
  function readUnquoted(value) {
    const comma = text.indexOf(',', pos);
    const lf = text.indexOf('\n', pos);
    let term = comma === -1 ? lf : (lf === -1 ? comma : (comma < lf ? comma : lf));
    let chunk;
    let termChar = -1;
    if (term === -1) {
      chunk = text.slice(pos);
    } else {
      chunk = text.slice(pos, term);
      termChar = text.charCodeAt(term);
    }
    let added = 0;
    const cr = chunk.indexOf('\r');
    if (cr === -1) {
      // The common case: no CR in the field at all.
      value = value === '' ? chunk : value + chunk;
      added = chunk.length;
    } else if (term === -1) {
      // No line feed follows anywhere, so every CR here is stray.
      let out = value;
      let start = 0;
      let p = cr;
      while (p !== -1) {
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        const piece = chunk.slice(start, p);
        out = out === '' ? piece : out + piece;
        added += piece.length;
        start = p + 1;
        p = chunk.indexOf('\r', start);
      }
      const tail = chunk.slice(start);
      value = out === '' ? tail : out + tail;
      added += tail.length;
    } else {
      // CRs before a terminator: each is stray unless it is the chunk's
      // last character and a line feed follows it (a CRLF line break).
      let out = value;
      let start = 0;
      let p = cr;
      let broke = false;
      while (p !== -1) {
        if (p === chunk.length - 1 && termChar === 10) {
          const piece = chunk.slice(start, p);
          out = out === '' ? piece : out + piece;
          added += piece.length;
          broke = true;
          break;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        const piece = chunk.slice(start, p);
        out = out === '' ? piece : out + piece;
        added += piece.length;
        start = p + 1;
        p = chunk.indexOf('\r', start);
      }
      if (!broke) {
        const tail = chunk.slice(start);
        value = out === '' ? tail : out + tail;
        added += tail.length;
      } else {
        value = out;
      }
      if (broke) {
        pos = term + 1;
        line++;
        fieldValue = value;
        fieldEnded = 1;
        fieldAdded = added;
        return;
      }
    }
    if (term === -1) {
      pos = n;
      fieldValue = value;
      fieldEnded = 2;
      fieldAdded = added;
      return;
    }
    if (termChar === 44) {
      pos = term + 1;
      fieldValue = value;
      fieldEnded = 0;
      fieldAdded = added;
    } else {
      pos = term + 1;
      line++;
      fieldValue = value;
      fieldEnded = 1;
      fieldAdded = added;
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
        if (chunk.indexOf('\n') === -1 && chunk.indexOf('\r') === -1) {
          piece = chunk + '"';
        } else {
          normalizeChunk(chunk);
          piece = normValue + '"';
          line += normLines;
        }
        value = first ? piece : value + piece;
        first = false;
        p = q + 2;
        continue;
      }
      // The closing quote.
      if (chunk.indexOf('\n') === -1 && chunk.indexOf('\r') === -1) {
        value = first ? chunk : value + chunk;
      } else {
        normalizeChunk(chunk);
        value = first ? normValue : value + normValue;
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
