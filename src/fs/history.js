// History management: history/context_NNN.md, history/output_NNN.md, output.txt, topics.csv reads
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PATHS } from './workspace.js';

const { HISTORY_DIR, OUTPUT_FILE, TOPICS_FILE } = PATHS;

function pad3(n) {
  return String(n).padStart(3, '0');
}

export function nextId() {
  if (!existsSync(TOPICS_FILE)) return 1;
  const raw = readFileSync(TOPICS_FILE, 'utf8').trim();
  if (!raw) return 1;
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return 1; // header only
  const last = lines[lines.length - 1].split(',')[0];
  const n = parseInt(last, 10);
  return isNaN(n) ? 1 : n + 1;
}

export function contextFile(id) {
  return `context_${pad3(id)}.md`;
}

export function outputFile(id) {
  return `output_${pad3(id)}.md`;
}

export function saveContext(id, topic, markdown) {
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
  const path = resolve(HISTORY_DIR, contextFile(id));
  writeFileSync(path, markdown, 'utf8');
  return path;
}

export function saveOutput(id, topic, markdown) {
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
  // Save timestamped copy in history/
  const historyPath = resolve(HISTORY_DIR, outputFile(id));
  writeFileSync(historyPath, markdown, 'utf8');
  // Overwrite output.txt with the latest
  writeFileSync(OUTPUT_FILE, markdown, 'utf8');
  return { historyPath, latestPath: OUTPUT_FILE };
}

export function phaseFile(id, phaseName) {
  return `${phaseName}_${pad3(id)}.md`;
}

export function savePhaseOutput(id, phaseName, markdown) {
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
  const path = resolve(HISTORY_DIR, phaseFile(id, phaseName));
  writeFileSync(path, markdown, 'utf8');
  return path;
}

export function listHistory() {
  if (!existsSync(TOPICS_FILE)) return [];
  const raw = readFileSync(TOPICS_FILE, 'utf8').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [];

  const parseRow = (line) => {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && line[i + 1] === '"' && inQuotes) {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        out.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  };

  return lines.slice(1).map((line) => {
    const fields = parseRow(line);
    const [id, topic, ran_at, word_count, context_file, output_file, model_provider, image_provider, image_providers_used] = fields;
    return {
      id,
      topic,
      ran_at,
      word_count: parseInt(word_count, 10) || 0,
      context_file,
      output_file,
      model_provider: model_provider || '',
      image_provider: image_provider || '',
      image_providers_used: image_providers_used || '',
    };
  });
}