// Phase spinners for the research pipeline. Wraps `ora` with a uniform
// interface so agent.js can show live "phase N of M" progress with in-place
// status updates (hits, claims, sources, words, etc.).
//
// The wrapper auto-degrades to plain stdout text when:
//   - stdout is not a TTY (piped / CI)
//   - NO_BANNER is set
//   - chalk reports level 0
import ora from 'ora';
import chalk from 'chalk';

function shouldAnimate() {
  if (!process.stdout.isTTY) return false;
  if (process.env.NO_BANNER) return false;
  if (process.env.CI) return false;
  return true;
}

/**
 * Create a per-phase spinner.
 *
 * @param {number} n - phase index (1-based)
 * @param {number} total - total phase count
 * @param {string} label - phase label, e.g. "Searching the web"
 * @returns {{
 *   start: () => PhaseSpinner,
 *   tick: (stat: string) => PhaseSpinner,
 *   setStatus: (msg: string) => PhaseSpinner,
 *   succeed: (msg?: string) => PhaseSpinner,
 *   fail: (msg?: string) => PhaseSpinner,
 *   stop: () => PhaseSpinner,
 *   elapsed: () => number,
 * }}
 */
export function createPhaseSpinner(n, total, label) {
  const startedAt = Date.now();
  const tag = `[${n}/${total}]`;
  const initialText = `${chalk.cyan(tag)} ${chalk.bold(label)}`;
  const spinner = shouldAnimate() ? ora({ text: initialText, color: 'cyan' }) : null;
  const stats = [];

  function compose(text, stat) {
    if (stat) stats.push(stat);
    const statLine = stats.length ? chalk.dim(` · ${stats[stats.length - 1]}`) : '';
    return `${text}${statLine}`;
  }

  const api = {
    start() {
      if (spinner) spinner.start();
      else process.stdout.write(`${initialText}\n`);
      return api;
    },
    tick(stat) {
      const text = compose(`${chalk.cyan(tag)} ${chalk.bold(label)}`, stat);
      if (spinner) spinner.text = text;
      else process.stdout.write(`  ↳ ${stat}\n`);
      return api;
    },
    setStatus(msg) {
      const text = `${chalk.cyan(tag)} ${chalk.bold(label)} ${chalk.dim('· ' + msg)}`;
      if (spinner) spinner.text = text;
      else process.stdout.write(`  ↳ ${msg}\n`);
      return api;
    },
    succeed(msg) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      const tail = msg ? ` — ${msg}` : '';
      const text = `${chalk.cyan(tag)} ${chalk.green('✓ ' + label)} ${chalk.dim(elapsed + 's')}${chalk.dim(tail)}`;
      if (spinner) {
        spinner.succeed(text);
      } else {
        process.stdout.write(`${text}\n`);
      }
      return api;
    },
    fail(msg) {
      const text = `${chalk.cyan(tag)} ${chalk.red('✗ ' + label)}${msg ? ' — ' + chalk.red(msg) : ''}`;
      if (spinner) spinner.fail(text);
      else process.stdout.write(`${text}\n`);
      return api;
    },
    stop() {
      if (spinner) spinner.stop();
      return api;
    },
    elapsed() {
      return Date.now() - startedAt;
    },
  };
  return api;
}
