// Agent orchestrator. Runs the six phases sequentially and writes all output files.
//
// Phase progress is shown via the spinner wrapper in ui/progress.js. Each
// phase reports its own start, in-place updates (hits, claims, sources…),
// and a final succeed/fail line. Final summary + KB location are rendered
// through ui/panels.js.
import chalk from 'chalk';
import { readPreferences, appendTopic, workspaceInit } from './fs/workspace.js';
import { nextId, saveOutput, savePhaseOutput } from './fs/history.js';
import { searchPhase } from './phases/search.js';
import { crosscheckPhase } from './phases/crosscheck.js';
import { knowledgePhase, saveKnowledgeBase } from './phases/knowledge.js';
import { verifyPhase } from './phases/verify.js';
import { writePhase } from './phases/write.js';
import { illustratePhase } from './phases/illustrate.js';
import { activeProvider, defaultModel } from './groq.js';
import { createPhaseSpinner } from './ui/progress.js';
import { infoPanel, successPanel, warnPanel } from './ui/panels.js';

function wordCount(s) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Render crosscheck results as markdown. */
function renderCrosscheckMd(topic, claims, flagged) {
  const lines = [`# Cross-Check: ${topic}`, ''];
  lines.push('## Claims');
  for (const c of claims) lines.push(`- [${(c.confidence || 'medium').toUpperCase()}] ${c.claim}`);
  lines.push('');
  lines.push('## Flagged / uncertain');
  for (const f of flagged) lines.push(`- ${f}`);
  lines.push('');
  return lines.join('\n');
}

/** Render verify results as markdown. */
function renderVerifyMd(topic, kb, originalKb) {
  const lines = [`# Verification: ${topic}`, ''];
  lines.push('## Cleaned facts');
  for (const f of kb.facts || []) lines.push(`- [${(f.confidence || 'medium').toUpperCase()}] ${f.claim}`);
  lines.push('');
  const added = (kb.flagged || []).filter((f) => !(originalKb.flagged || []).includes(f));
  if (added.length > 0) {
    lines.push('## Newly flagged');
    for (const f of added) lines.push(`- ${f}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Render illustrate results as markdown. */
function renderIllustrateMd(topic, images) {
  const lines = [`# Image Placements: ${topic}`, ''];
  if (images.length === 0) {
    lines.push('No images inserted.');
  } else {
    for (const img of images) {
      lines.push(`- After paragraph ${img.afterParagraph || '?'}: "${img.query}" → ${img.url} (${img.provider})`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** Format model label for spinner tick. */
function modelLabel(llmOpts) {
  if (!llmOpts?.provider) return null;
  return `${llmOpts.provider}/${llmOpts.model}`;
}

/**
 * Run the full pipeline for a topic.
 * @param {string} topic
 * @param {object} [opts]
 * @param {Record<string, {provider: string, model: string}>} [opts.phaseModels]
 */
export async function run(topic, opts = {}) {
  workspaceInit(); // ensure workspace exists before reading prefs
  const prefs = readPreferences();
  const id = nextId();
  const includeImages = String(prefs.INCLUDE_IMAGES || 'true').toLowerCase() === 'true';
  const totalPhases = includeImages ? 6 : 5; // illustrate is optional
  const { phaseModels } = opts;

  let kbPath = null;

  try {
    // Phase 1: Search
    const llm1 = phaseModels?.search;
    const s1 = createPhaseSpinner(1, totalPhases, 'Searching the web').start();
    const ml1 = modelLabel(llm1);
    if (ml1) s1.tick(ml1);
    const { provider, hits, notes } = await searchPhase(topic, llm1);
    if (hits.length === 0) {
      s1.tick('0 hits — continuing with limited context');
    } else {
      s1.tick(`${provider} · ${hits.length} hits${ml1 ? ` · ${ml1}` : ''}`);
    }
    savePhaseOutput(id, 'search', `# Search Notes: ${topic}\n\n${notes}\n`);
    s1.succeed();

    // Phase 2: Cross-check
    const llm2 = phaseModels?.crosscheck;
    const s2 = createPhaseSpinner(2, totalPhases, 'Cross-checking facts').start();
    const ml2 = modelLabel(llm2);
    if (ml2) s2.tick(ml2);
    const { claims, flagged } = await crosscheckPhase(notes, hits, llm2);
    s2.tick(`${claims.length} claims · ${flagged.length} flagged${ml2 ? ` · ${ml2}` : ''}`);
    savePhaseOutput(id, 'crosscheck', renderCrosscheckMd(topic, claims, flagged));
    s2.succeed();

    // Phase 3: Knowledge base (saved to disk immediately)
    const llm3 = phaseModels?.knowledge;
    const s3 = createPhaseSpinner(3, totalPhases, 'Building knowledge base').start();
    const ml3 = modelLabel(llm3);
    if (ml3) s3.tick(ml3);
    const kbRaw = await knowledgePhase(topic, claims, flagged, hits, llm3);
    kbPath = saveKnowledgeBase(id, topic, kbRaw);
    s3.tick(`saved → ${chalk.dim(shortenPath(kbPath))}${ml3 ? ` · ${ml3}` : ''}`);
    s3.succeed();

    // Phase 4: Verify
    const llm4 = phaseModels?.verify;
    const s4 = createPhaseSpinner(4, totalPhases, 'Verifying knowledge base').start();
    const ml4 = modelLabel(llm4);
    if (ml4) s4.tick(ml4);
    const kb = await verifyPhase(kbRaw, llm4);
    // Overwrite the saved KB with the verified version so disk matches what the writer saw.
    saveKnowledgeBase(id, topic, kb);
    s4.tick(`${kb.facts.length} facts after verification${ml4 ? ` · ${ml4}` : ''}`);
    savePhaseOutput(id, 'verify', renderVerifyMd(topic, kb, kbRaw));
    s4.succeed();

    // Phase 5: Write
    const llm5 = phaseModels?.write;
    const s5 = createPhaseSpinner(5, totalPhases, 'Writing article').start();
    const ml5 = modelLabel(llm5);
    if (ml5) s5.tick(ml5);
    let article = await writePhase(topic, kb, prefs, llm5);
    const title = `${topic[0].toUpperCase()}${topic.slice(1)}`;
    s5.tick(`${wordCount(article)} words${ml5 ? ` · ${ml5}` : ''}`);
    s5.succeed();

    // Phase 6: Illustrate (optional)
    let images = [];
    let imageProvidersUsed = [];
    if (includeImages) {
      const llm6 = phaseModels?.illustrate;
      const s6 = createPhaseSpinner(6, totalPhases, 'Finding images').start();
      const ml6 = modelLabel(llm6);
      if (ml6) s6.tick(ml6);
      const result = await illustratePhase(article, prefs.IMAGE_PROVIDER || 'unsplash', llm6);
      images = result.images;
      imageProvidersUsed = result.providersUsed || [];
      article = result.article;
      s6.tick(`${images.length} of ${images.length || '?'} inserted${ml6 ? ` · ${ml6}` : ''}`);
      savePhaseOutput(id, 'illustrate', renderIllustrateMd(topic, images));
      s6.succeed();
    }

    // Persist
    const finalOutput = `# ${title}\n\n${article}\n`;
    saveOutput(id, topic, finalOutput);

    const now = new Date().toISOString();
    appendTopic({
      id,
      topic,
      ranAt: now,
      wordCount: wordCount(article),
      contextFile: `context_${String(id).padStart(3, '0')}.md`,
      outputFile: `output_${String(id).padStart(3, '0')}.md`,
      modelProvider: activeProvider(),
      imageProvider: prefs.IMAGE_PROVIDER || 'unsplash',
      imageProvidersUsed: imageProvidersUsed.join(','),
    });

    // Final summary panel
    const lines = [
      `${chalk.bold(wordCount(article))} words  ·  ${chalk.dim(article.length + ' chars')}`,
      `${chalk.dim('LLM')}      ${activeProvider()} (${defaultModel()})`,
      includeImages
        ? `${chalk.dim('Images')}   ${images.length > 0 ? `${images.length} from ${imageProvidersUsed.join(', ') || 'unknown'}` : chalk.dim('skipped — no provider returned a hit')}`
        : `${chalk.dim('Images')}   ${chalk.dim('skipped (INCLUDE_IMAGES=false)')}`,
      kbPath ? `${chalk.dim('KB')}       ${chalk.dim(shortenPath(kbPath))}` : null,
      `${chalk.dim('Saved to')} ${chalk.dim('./output.txt')}`,
    ].filter(Boolean);

    // Show per-phase models if they were customized
    if (phaseModels) {
      const phaseLabels = { search: 'Search', crosscheck: 'Cross-check', knowledge: 'KB', verify: 'Verify', write: 'Write', illustrate: 'Illustrate' };
      const modelLines = Object.entries(phaseModels).map(([k, v]) =>
        `${chalk.dim((phaseLabels[k] || k).padEnd(12))} ${v.provider}/${v.model}`
      );
      lines.push('', chalk.bold('Per-phase models:'), ...modelLines);
    }

    successPanel('article ready', lines.join('\n'));
  } catch (err) {
    // If we got as far as phase 3, the KB is already on disk — tell the user.
    if (kbPath) {
      warnPanel('partial run', `KB saved to ${chalk.cyan(shortenPath(kbPath))}. Article not produced.`);
    }
    process.stderr.write(`elora-voss: ${err.message || String(err)}\n`);
    if (err?.stack) process.stderr.write(err.stack + '\n');
    process.exit(1);
  }
}

function shortenPath(p) {
  if (!p) return '';
  return p.replace(process.cwd() + '\\', './').replace(process.cwd() + '/', './');
}
