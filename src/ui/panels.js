// Framed boxen panels for success / error / info / key-value output.
// Degrades to plain text when stdout is not a TTY.
import chalk from 'chalk';
import boxen from 'boxen';

function tty() {
  return Boolean(process.stdout.isTTY) && chalk.level > 0 && !process.env.NO_COLOR && !process.env.CI;
}

function rule(title) {
  return tty() ? chalk.bold.underline(title) : title;
}

/**
 * @param {string} title
 * @param {string|string[]} body
 * @param {object} [opts]
 * @param {'green'|'red'|'cyan'|'yellow'|'magenta'} [opts.color]
 */
export function panel(title, body, opts = {}) {
  const text = Array.isArray(body) ? body.join('\n') : body;
  if (!tty()) {
    process.stdout.write(`${title}\n${text}\n\n`);
    return;
  }
  const color = opts.color || 'cyan';
  const frame = boxen(text, {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    margin: { top: 0, bottom: 1, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: color,
    title: ` ${title} `,
    titleAlignment: 'left',
  });
  process.stdout.write(frame + '\n');
}

export function successPanel(title, body) {
  panel(title, body, { color: 'green' });
}

export function errorPanel(title, body) {
  panel(title, body, { color: 'red' });
}

export function infoPanel(title, body) {
  panel(title, body, { color: 'cyan' });
}

export function warnPanel(title, body) {
  panel(title, body, { color: 'yellow' });
}

/**
 * Render a key-value table (used for `keys`, `preferences`, summary stats).
 * @param {Array<[string,string]>} rows
 * @param {object} [opts]
 * @param {string} [opts.title]
 * @param {string} [opts.color]
 */
export function keyValuePanel(rows, opts = {}) {
  if (!rows.length) return;
  if (!tty()) {
    if (opts.title) process.stdout.write(`${rule(opts.title)}\n`);
    const w = Math.max(...rows.map(([k]) => k.length));
    for (const [k, v] of rows) process.stdout.write(`  ${k.padEnd(w)}  ${v}\n`);
    process.stdout.write('\n');
    return;
  }
  const w = Math.max(...rows.map(([k]) => k.length));
  const body = rows
    .map(([k, v]) => {
      const label = chalk.bold.cyan(k.padEnd(w));
      const dim = v === 'not set' || v === '' || v === 'none';
      return `  ${label}  ${dim ? chalk.dim(v || '—') : chalk.white(v)}`;
    })
    .join('\n');
  panel(opts.title || 'details', body, { color: opts.color || 'cyan' });
}

/**
 * Render a bordered table with a header row. Used for `history`.
 * @param {string[]} headers
 * @param {string[][]} rows
 * @param {object} [opts]
 * @param {string} [opts.title]
 */
export function tablePanel(headers, rows, opts = {}) {
  if (!rows.length) {
    infoPanel(opts.title || 'history', 'no rows yet');
    return;
  }
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] || '').length)));
  const fmt = (cells, style) => cells.map((c, i) => (style ? style(c, i) : c).padEnd(widths[i])).join('  ');
  if (!tty()) {
    if (opts.title) process.stdout.write(`${rule(opts.title)}\n`);
    process.stdout.write(fmt(headers) + '\n');
    process.stdout.write(widths.map((w) => '-'.repeat(w)).join('  ') + '\n');
    for (const r of rows) process.stdout.write(fmt(r) + '\n');
    process.stdout.write('\n');
    return;
  }
  const styledHeaders = headers.map((h) => chalk.bold.cyan(h));
  const body = [
    fmt(styledHeaders),
    widths.map((w) => chalk.dim('-'.repeat(w))).join('  '),
    ...rows.map((r) => fmt(r, (c) => chalk.white(c))),
  ].join('\n');
  panel(opts.title || 'history', body, { color: 'magenta' });
}

/**
 * A short, framed panel used by `doc` to render a titled example block.
 * @param {string} title
 * @param {string|string[]} body
 */
export function examplePanel(title, body) {
  panel(title, body, { color: 'cyan' });
}

/**
 * Render a health-check report. Each row is
 * `{ name, status: 'ok' | 'warn' | 'fail', detail, ms? }`. Sorted: fails first,
 * then warns, then oks. With `json: true`, emits a single JSON object to stdout
 * and returns true (caller should not also write).
 *
 * @param {Array<{name:string,status:'ok'|'warn'|'fail',detail:string,ms?:number}>} rows
 * @param {object} [opts]
 * @param {string} [opts.title]
 * @param {boolean} [opts.verbose] - include per-check timings
 * @param {boolean} [opts.json] - if true, only emit JSON to stdout
 * @returns {boolean} true if `--json` was set (caller should skip its own output)
 */
export function doctorReportPanel(rows, opts = {}) {
  const order = { fail: 0, warn: 1, ok: 2 };
  const sorted = [...rows].sort((a, b) => order[a.status] - order[b.status]);

  if (opts.json) {
    const summary = sorted.reduce(
      (acc, r) => { acc[r.status]++; return acc; },
      { ok: 0, warn: 0, fail: 0 }
    );
    const out = {
      ok: summary.fail === 0,
      summary: { ok: summary.ok, warn: summary.warn, fail: summary.fail, total: sorted.length },
      checks: sorted.map((r) => ({
        name: r.name,
        status: r.status,
        detail: r.detail,
        ...(opts.verbose && r.ms != null ? { ms: r.ms } : {}),
      })),
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return true;
  }

  if (!rows.length) {
    infoPanel(opts.title || 'doctor', 'no checks');
    return false;
  }
  if (!tty()) {
    if (opts.title) process.stdout.write(`${rule(opts.title)}\n`);
    const w = Math.max(...sorted.map((r) => r.name.length));
    for (const r of sorted) {
      const tag = r.status === 'ok' ? 'OK  ' : r.status === 'warn' ? 'WARN' : 'FAIL';
      const timing = opts.verbose && r.ms != null ? ` (${r.ms}ms)` : '';
      process.stdout.write(`  ${tag}  ${r.name.padEnd(w)}  ${r.detail}${timing}\n`);
    }
    process.stdout.write('\n');
    return false;
  }

  const w = Math.max(...sorted.map((r) => r.name.length));
  const tagOf = (s) => s === 'ok' ? chalk.green('OK  ') : s === 'warn' ? chalk.yellow('WARN') : chalk.red('FAIL');
  const nameOf = (s) => s === 'ok' ? chalk.white : s === 'warn' ? chalk.yellow : chalk.red;
  const body = sorted
    .map((r) => {
      const timing = opts.verbose && r.ms != null ? chalk.dim(` (${r.ms}ms)`) : '';
      return `  ${tagOf(r.status)}  ${nameOf(r.status)(r.name.padEnd(w))}  ${chalk.white(r.detail)}${timing}`;
    })
    .join('\n');
  const summary = sorted.reduce(
    (acc, r) => { acc[r.status]++; return acc; },
    { ok: 0, warn: 0, fail: 0 }
  );
  const total = sorted.length;
  const footer = chalk.dim(`${summary.ok} ok · ${summary.warn} warn · ${summary.fail} fail · ${total} total`);
  panel(opts.title || 'doctor', `${body}\n\n${footer}`, { color: summary.fail > 0 ? 'red' : summary.warn > 0 ? 'yellow' : 'green' });
  return false;
}
