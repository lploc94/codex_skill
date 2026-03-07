#!/usr/bin/env node

// Runtime guard: Node.js >= 22 required (Codex CLI requirement)
const major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 22) {
  console.error(`Error: Node.js >= 22 required (found ${process.version})`);
  process.exit(1);
}

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');

const skillPackDir = path.join(packageRoot, 'skill-packs', 'codex-review');
const skillsRoot = path.join(os.homedir(), '.claude', 'skills');
const runnerDir = path.join(skillsRoot, 'codex-review');
const runnerPath = path.join(runnerDir, 'scripts', 'codex-runner.js');

const SKILLS = ['codex-plan-review', 'codex-impl-review', 'codex-think-about', 'codex-commit-review', 'codex-pr-review', 'codex-parallel-review', 'codex-codebase-review', 'codex-security-review'];

// All directories managed by this installer (runner + 8 skills)
const MANAGED_DIRS = ['codex-review', ...SKILLS];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape characters special in double-quoted shell strings: \ " $ ` */
function escapeForDoubleQuotedShell(s) {
  return s.replace(/[\\"$`]/g, '\\$&');
}

/** Recursively copy a directory */
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Build staging directory
// ---------------------------------------------------------------------------

const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const stagingDir = path.join(skillsRoot, `.codex-staging-${uid}`);

try {
  fs.mkdirSync(stagingDir, { recursive: true });

  // 1. Copy codex-runner.js into staging/codex-review/scripts/
  const runnerSrc = path.join(skillPackDir, 'scripts', 'codex-runner.js');
  const runnerDest = path.join(stagingDir, 'codex-review', 'scripts', 'codex-runner.js');
  fs.mkdirSync(path.dirname(runnerDest), { recursive: true });
  fs.copyFileSync(runnerSrc, runnerDest);

  // chmod +x on Unix
  if (process.platform !== 'win32') {
    fs.chmodSync(runnerDest, 0o755);
  }

  // 2. Process each skill: inject RUNNER_PATH into SKILL.md, copy references/
  const escapedRunnerPath = escapeForDoubleQuotedShell(runnerPath);

  for (const skill of SKILLS) {
    const skillSrcDir = path.join(skillPackDir, 'skills', skill);
    const skillDestDir = path.join(stagingDir, skill);
    fs.mkdirSync(skillDestDir, { recursive: true });

    // Read template SKILL.md, inject runner path
    const templatePath = path.join(skillSrcDir, 'SKILL.md');
    const template = fs.readFileSync(templatePath, 'utf8');
    if (!template.includes('{{RUNNER_PATH}}')) {
      throw new Error(`Template ${skill}/SKILL.md missing {{RUNNER_PATH}} placeholder`);
    }
    const injected = template.replaceAll('{{RUNNER_PATH}}', escapedRunnerPath);
    if (injected.includes('{{RUNNER_PATH}}')) {
      throw new Error(`Template ${skill}/SKILL.md still contains {{RUNNER_PATH}} after injection`);
    }
    fs.writeFileSync(path.join(skillDestDir, 'SKILL.md'), injected, 'utf8');

    // Copy references/ directory (required by all skills)
    const refsSrc = path.join(skillSrcDir, 'references');
    if (!fs.existsSync(refsSrc)) {
      throw new Error(`Missing references/ directory for ${skill}`);
    }
    copyDirSync(refsSrc, path.join(skillDestDir, 'references'));
  }

  // 3. Verify runner works
  console.log('Verifying codex-runner.js ...');
  const runnerTestPath = path.join(stagingDir, 'codex-review', 'scripts', 'codex-runner.js');
  const versionOutput = execFileSync(process.execPath, [runnerTestPath, 'version'], {
    encoding: 'utf8',
    timeout: 10_000,
  }).trim();
  console.log(`  codex-runner.js version: ${versionOutput}`);

  // 4. Atomic swap per directory: backup old → move staging → cleanup
  fs.mkdirSync(skillsRoot, { recursive: true });
  const backups = [];    // dirs that had a previous install → backed up
  const swapped = [];    // dirs successfully moved from staging → target
  try {
    for (const dir of MANAGED_DIRS) {
      const target = path.join(skillsRoot, dir);
      const staged = path.join(stagingDir, dir);
      if (fs.existsSync(target)) {
        const backup = path.join(skillsRoot, `.${dir}-backup-${uid}`);
        fs.renameSync(target, backup);
        backups.push({ dir, target, backup });
      }
      fs.renameSync(staged, target);
      swapped.push({ dir, target });
    }
  } catch (err) {
    // Swap failed → full rollback: remove new targets, restore backups
    const rollbackErrors = [];
    for (const { dir, target } of swapped) {
      try { fs.rmSync(target, { recursive: true, force: true }); } catch (e) {
        rollbackErrors.push(`rm ${dir}: ${e.message}`);
      }
    }
    for (const { dir, target, backup } of backups) {
      try { fs.renameSync(backup, target); } catch (e) {
        rollbackErrors.push(`restore ${dir}: ${e.message}`);
      }
    }
    if (rollbackErrors.length) {
      console.error('Rollback errors (manual cleanup may be needed):');
      for (const re of rollbackErrors) console.error(`  - ${re}`);
    }
    throw new Error(`Installation failed: ${err.message}`);
  }

  // Cleanup backups and empty staging dir (non-critical — install already succeeded)
  for (const { backup } of backups) {
    try {
      fs.rmSync(backup, { recursive: true, force: true });
    } catch {
      console.warn(`Warning: could not remove backup at ${backup}`);
    }
  }
  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  } catch {
    // staging dir may already be gone
  }

  // 5. Success message
  console.log('');
  console.log('codex-review skills installed successfully!');
  console.log(`  Runner:  ${runnerDir}`);
  console.log(`  Skills:  ${skillsRoot}/codex-{plan-review,impl-review,think-about,commit-review,pr-review,parallel-review,codebase-review,security-review}`);
  console.log('');
  console.log('Skills available in Claude Code:');
  console.log('  /codex-plan-review     — debate plans before implementation');
  console.log('  /codex-impl-review     — review uncommitted or branch changes');
  console.log('  /codex-think-about     — peer reasoning/debate');
  console.log('  /codex-commit-review   — review commit messages');
  console.log('  /codex-pr-review       — review PRs (branch diff + description)');
  console.log('  /codex-parallel-review — parallel dual-reviewer analysis + debate');
  console.log('  /codex-codebase-review — chunked full-codebase review (50-500+ files)');
  console.log('  /codex-security-review — security-focused review (OWASP Top 10 + CWE)');
} catch (err) {
  // Cleanup staging on any error
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  console.error(err.message || err);
  process.exit(1);
}
