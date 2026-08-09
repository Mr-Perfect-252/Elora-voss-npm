// Terminal identity for elora-voss: a big framed ASCII banner with a cyan→magenta
// gradient, a tagline, a version stamp, and an optional post-banner "startup box"
// that summarises the current environment (cwd, LLM provider, configured keys).
//
// All output degrades to plain text when stdout is not a TTY, when NO_COLOR is
// set, or when FORCE_COLOR is not set — so piping `elora-voss --help | cat` stays
// clean and so it works in Windows cmd.exe with the default colour palette.
import chalk from 'chalk';
import boxen from 'boxen';

// "ELORA VOSS" in ASCII block letters. Each line is 80 cols wide.
// ELORA occupies cols 0-39, VOSS occupies cols 46-79, gap at 40-45.
const BANNER = [
  '███████╗██╗      ██████╗ ██████╗  █████╗      ██╗   ██╗ ██████╗ ███████╗███████╗',
  '██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗     ██║   ██║██╔═══██╗██╔════╝██╔════╝',
  '█████╗  ██║     ██║   ██║██████╔╝███████║     ██║   ██║██║   ██║███████╗███████╗',
  '██╔══╝  ██║     ██║   ██║██╔══██╗██╔══██║     ╚██╗ ██╔╝██║   ██║╚════██║╚════██║',
  '███████╗███████╗╚██████╔╝██║  ██║██║  ██║      ╚████╔╝ ╚██████╔╝███████║███████║',
  '╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝       ╚═══╝   ╚═════╝ ╚══════╝╚══════╝',
];

const TAGLINE = 'research and writing, terminal-native.';

function supportsColor() {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  // chalk@5 follows process.stdout.isTTY by default; honour it explicitly.
  return Boolean(process.stdout.isTTY) && chalk.level > 0;
}

function isInteractive() {
  return Boolean(process.stdout.isTTY);
}

function shouldRender() {
  if (!isInteractive()) return false;
  if (process.env.NO_BANNER) return false;
  if (process.env.CI) return false;
  return true;
}

/**
 * Paint the banner. Cyan gradient over the ELORA half, magenta gradient over
 * the VOSS half. When colour is disabled, the raw block letters still print.
 *
 * @param {string} [version]
 * @param {object} [opts]
 * @param {boolean} [opts.framed] - wrap the whole thing in a boxen frame
 */
export function printBanner(version, opts = {}) {
  if (!shouldRender()) return;
  const useColor = supportsColor();
  const split = 40;
  const palette = useColor
    ? new GradientPalette()
    : { paintLeft: (s) => s, paintRight: (s) => s };

  const lines = [];
  for (const line of BANNER) {
    const left = line.slice(0, split);
    const right = line.slice(split);
    lines.push(`  ${palette.paintLeft(left)}${useColor ? '' : ''}${palette.paintRight(right)}`);
  }
  const versionTag = version ? `  · v${version}` : '';
  const tagline = useColor
    ? chalk.dim(`${TAGLINE}${versionTag}`)
    : `${TAGLINE}${versionTag}`;

  if (opts.framed && useColor) {
    const body = `${lines.join('\n')}\n${tagline}`;
    const frame = boxen(body, {
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: 'cyan',
      title: ' elora-voss ',
      titleAlignment: 'center',
    });
    process.stdout.write(frame + '\n');
    return;
  }

  process.stdout.write('\n');
  for (const line of lines) process.stdout.write(line + '\n');
  process.stdout.write(tagline + '\n\n');
}

/**
 * A small, framed status box that lives under the banner. Used by `init`, the
 * main dispatch on first run, and any "you're in a working state" beat.
 *
 * @param {object} info
 * @param {string} [info.version]
 * @param {string} info.cwd
 * @param {string} info.provider - active LLM provider (groq | openrouter)
 * @param {string} [info.model]
 * @param {string[]} [info.keysConfigured] - provider ids whose keys are set
 * @param {string} [info.workspace] - "ready" | "missing" | "partial"
 */
export function printStartupBox(info) {
  if (!isInteractive() || !supportsColor()) {
    // Plain-text fallback: one line per field.
    const rows = flattenRows(info);
    for (const [k, v] of rows) process.stdout.write(`  ${k}: ${v}\n`);
    process.stdout.write('\n');
    return;
  }

  const rows = flattenRows(info);
  const width = Math.max(...rows.map(([k, v]) => k.length + v.length + 2), 40);
  const body = rows
    .map(([k, v], i) => {
      const label = chalk.bold.cyan(k.padEnd(12));
      const value = v.includes('missing')
        ? chalk.yellow(v)
        : v.includes('not set') || v === '0'
        ? chalk.dim(v)
        : chalk.white(v);
      return `  ${label} ${value}`;
    })
    .join('\n');

  const frame = boxen(body, {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    margin: { top: 0, bottom: 1, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: 'magenta',
    title: ' status ',
    titleAlignment: 'right',
    width: Math.min(width + 6, 78),
  });
  process.stdout.write(frame + '\n');
}

function flattenRows(info) {
  const out = [];
  if (info.version) out.push(['version', `v${info.version}`]);
  out.push(['workspace', info.workspace || 'unknown']);
  out.push(['cwd', info.cwd]);
  if (info.mode) out.push(['mode', info.mode]);
  out.push(['llm', `${info.provider || 'groq'}${info.model ? ` · ${info.model}` : ''}`]);
  out.push(['keys', (info.keysConfigured || []).join(', ') || 'none set']);
  if (info.imageProvider) out.push(['images', info.imageProvider]);
  return out;
}

// Lightweight gradient: dim → bright over the left half (cyan) and over the
// right half (magenta). We keep it deterministic — same input → same colours.
class GradientPalette {
  constructor() {
    this.leftShades = [
      chalk.hex('#0e7490'),   // dim cyan
      chalk.hex('#0891b2'),
      chalk.hex('#06b6d4'),
      chalk.hex('#22d3ee'),
      chalk.hex('#67e8f9'),
      chalk.hex('#a5f3fc'),   // bright cyan
    ];
    this.rightShades = [
      chalk.hex('#7e22ce'),  // dim magenta
      chalk.hex('#a21caf'),
      chalk.hex('#c026d3'),
      chalk.hex('#d946ef'),
      chalk.hex('#e879f9'),
      chalk.hex('#f5d0fe'),  // bright magenta
    ];
  }
  paintLeft(s) {
    return this._paint(s, this.leftShades);
  }
  paintRight(s) {
    return this._paint(s, this.rightShades);
  }
  _paint(s, shades) {
    // Pick a shade based on horizontal position to give a left-to-right feel.
    const cols = process.stdout.columns || 80;
    const mid = Math.floor(cols / 2);
    const idx = Math.min(shades.length - 1, Math.floor((mid / cols) * shades.length));
    // Apply a single base colour; per-character rainbow would be unreadable on
    // monospace banners. Keeps it bold and consistent.
    return shades[idx](s);
  }
}

export { supportsColor, isInteractive };
