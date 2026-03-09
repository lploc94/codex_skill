#!/usr/bin/env node

/**
 * codex-runner.js — Cross-platform runner for Codex CLI (Node.js stdlib only).
 *
 * Replaces codex-runner.sh + codex-runner.py in a single file.
 * Subcommands: version, start, poll, stop, _watchdog
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);

// --- Constants ---
const CODEX_RUNNER_VERSION = 9;

const EXIT_SUCCESS = 0;
const EXIT_ERROR = 1;
const EXIT_TIMEOUT = 2;
const EXIT_TURN_FAILED = 3;
const EXIT_STALLED = 4;
const EXIT_CODEX_NOT_FOUND = 5;

const IS_WIN = process.platform === "win32";

// ============================================================
// Output Format Converters
// ============================================================

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSeverity(rawSeverity) {
  if (!rawSeverity) return "";
  const sev = String(rawSeverity).trim().toLowerCase();
  const map = {
    critical: "critical",
    blocker: "critical",
    high: "high",
    error: "high",
    medium: "medium",
    warning: "medium",
    warn: "medium",
    low: "low",
    note: "low",
    minor: "low",
    info: "info",
    informational: "info",
  };
  return map[sev] || sev;
}

function normalizeConfidence(rawConfidence) {
  if (!rawConfidence) return "";
  const conf = String(rawConfidence).trim().toLowerCase();
  if (conf.startsWith("high")) return "high";
  if (conf.startsWith("med")) return "medium";
  if (conf.startsWith("low")) return "low";
  return conf;
}

function stripInlineCode(raw) {
  if (!raw) return "";
  const text = String(raw).trim();
  if (text.startsWith("`") && text.endsWith("`")) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function parseLabeledSections(block) {
  const sections = {};
  const lines = String(block || "").split(/\r?\n/);
  let current = null;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      if (current) sections[current].push(line);
      continue;
    }

    if (!inFence) {
      const m = line.match(/^\s*(?:[-*]\s*)?(?:\*\*)?([A-Za-z][A-Za-z0-9 _/-]*?)(?:\*\*)?\s*:\s*(.*)\s*$/);
      if (m) {
        current = m[1].trim().toLowerCase().replace(/\s+/g, " ");
        if (!sections[current]) sections[current] = [];
        if (m[2]) sections[current].push(m[2]);
        continue;
      }
    }

    if (current) sections[current].push(line);
  }

  const out = {};
  for (const [k, parts] of Object.entries(sections)) {
    const value = parts.join("\n").trim();
    if (value) out[k] = value;
  }
  return out;
}

function getSectionValue(sections, aliases) {
  for (const alias of aliases) {
    const key = alias.toLowerCase().trim().replace(/\s+/g, " ");
    if (sections[key]) return sections[key];
  }
  return "";
}

function extractTextAndFirstCode(sectionText) {
  const text = String(sectionText || "").trim();
  if (!text) return { text: "", code: "" };

  const codeMatch = text.match(/```[^\n]*\n([\s\S]*?)```/);
  const code = codeMatch ? codeMatch[1].trim() : "";
  const withoutCode = text.replace(/```[^\n]*\n[\s\S]*?```/g, "").trim();
  const cleaned = withoutCode.replace(/^\s*[-*]\s*/gm, "").trim();
  return { text: cleaned, code };
}

function parseLocation(rawLocation, rawFile) {
  const locationText = stripInlineCode(rawLocation);
  const fileText = stripInlineCode(rawFile);

  const locMatch = locationText.match(/^(.*):(\d+)(?:-(\d+))?(?::(\d+)(?:-(\d+))?)?$/);
  if (locMatch) {
    const file = locMatch[1].trim();
    const startLine = parseInt(locMatch[2], 10);
    const endLine = locMatch[3] ? parseInt(locMatch[3], 10) : startLine;
    const startColumn = locMatch[4] ? parseInt(locMatch[4], 10) : undefined;
    const endColumn = locMatch[5] ? parseInt(locMatch[5], 10) : undefined;

    const location = {
      file,
      start_line: startLine,
      end_line: endLine,
    };
    if (startColumn) location.start_column = startColumn;
    if (endColumn) location.end_column = endColumn;
    return location;
  }

  if (fileText) return { file: fileText };
  if (locationText) return { file: locationText };
  return null;
}

function buildOwaspUrl(owaspId) {
  const base = String(owaspId || "").toUpperCase();
  if (!base) return "";
  return `https://owasp.org/Top10/${base.replace(":", "_")}/`;
}

function extractExternalRefs(block, sections) {
  const refs = [];
  const cweSeen = new Set();
  const owaspSeen = new Set();
  const sources = [
    String(block || ""),
    getSectionValue(sections, ["cwe"]),
    getSectionValue(sections, ["owasp"]),
  ].join("\n");

  const cweRegex = /\bCWE-(\d{1,5})\b/gi;
  for (const m of sources.matchAll(cweRegex)) {
    const idNum = m[1];
    const id = `CWE-${idNum}`;
    if (cweSeen.has(id)) continue;
    cweSeen.add(id);
    refs.push({
      type: "cwe",
      id,
      url: `https://cwe.mitre.org/data/definitions/${idNum}.html`,
    });
  }

  const owaspRegex = /\bA\d{2}:\d{4}\b/gi;
  for (const m of sources.matchAll(owaspRegex)) {
    const id = m[0].toUpperCase();
    if (owaspSeen.has(id)) continue;
    owaspSeen.add(id);
    refs.push({
      type: "owasp",
      id,
      url: buildOwaspUrl(id),
    });
  }

  return refs;
}

function parseBulletList(sectionText) {
  if (!sectionText) return [];
  const items = [];
  for (const line of String(sectionText).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)\s*$/);
    if (m) items.push(m[1].trim());
  }
  return items;
}

function buildSarifErrorDocument(message, canonicalJSON) {
  const toolName = canonicalJSON?.tool?.name || "codex-review";
  const toolVersion = canonicalJSON?.tool?.version || String(CODEX_RUNNER_VERSION);
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: {
        driver: {
          name: toolName,
          version: toolVersion,
          rules: [{
            id: "codex-review/conversion-error",
            shortDescription: { text: "Review conversion error" },
            fullDescription: { text: "Failed to convert review output to requested format." },
          }],
        },
      },
      results: [{
        ruleId: "codex-review/conversion-error",
        level: "error",
        message: {
          text: `Failed to convert review output to SARIF: ${String(message || "unknown error")}`,
        },
      }],
    }],
  };
}

/**
 * Parse Codex markdown output and convert to canonical JSON schema.
 * See docs/CANONICAL_JSON_SCHEMA.md for full specification.
 * 
 * @param {string} markdownOutput - Raw markdown from Codex
 * @param {object} metadata - Review metadata (skill, effort, etc.)
 * @returns {object} Canonical JSON review object
 */
function parseToCanonicalJSON(markdownOutput, metadata) {
  const text = String(markdownOutput || "");
  const meta = metadata || {};
  const findings = [];
  let verdict = null;

  // Supports:
  // - ## ISSUE-1: ...
  // - ### ISSUE-1: ...
  // - ISSUE-1: ...
  // - RESPONSE-1: ...
  const findingRegex = /^\s*(?:#{2,3}\s*)?(ISSUE-\d+|PERSPECTIVE-\d+|CROSS-\d+|RESPONSE-\d+)\s*:\s*(.+?)\s*$/gim;
  const matches = [...text.matchAll(findingRegex)];

  const verdictHeaderRegex = /^\s*(?:#{2,3}\s*)?VERDICT(?:\s*:\s*([A-Za-z|/\-\s]+))?\s*$/im;
  const verdictHeaderMatch = verdictHeaderRegex.exec(text);
  const verdictStart = verdictHeaderMatch ? verdictHeaderMatch.index : -1;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const id = String(match[1]).toUpperCase();
    const title = String(match[2] || "").trim();
    const startIdx = match.index + match[0].length;

    let endIdx;
    if (i < matches.length - 1) {
      endIdx = matches[i + 1].index;
    } else if (verdictStart >= 0 && verdictStart > startIdx) {
      endIdx = verdictStart;
    }

    const block = text.slice(startIdx, endIdx);
    const sections = parseLabeledSections(block);

    let type = "issue";
    if (id.startsWith("PERSPECTIVE-")) type = "perspective";
    if (id.startsWith("CROSS-")) type = "cross-cutting";
    if (id.startsWith("RESPONSE-")) type = "response";

    const finding = { id, type, title };

    const category = getSectionValue(sections, ["category"]);
    const severityRaw = getSectionValue(sections, ["severity"]);
    const confidenceRaw = getSectionValue(sections, ["confidence"]);
    const statusRaw = getSectionValue(sections, ["status"]);
    const fileRaw = getSectionValue(sections, ["file"]);
    const locationRaw = getSectionValue(sections, ["location"]);

    if (category) finding.category = category.trim().toLowerCase();
    if (severityRaw) {
      finding.raw_severity = severityRaw.trim().toLowerCase();
      finding.severity = normalizeSeverity(severityRaw);
    }
    if (confidenceRaw) finding.confidence = normalizeConfidence(confidenceRaw);
    if (statusRaw) finding.status = statusRaw.trim().toLowerCase();

    const parsedLocation = parseLocation(locationRaw, fileRaw);
    if (parsedLocation) finding.location = parsedLocation;

    const problem = getSectionValue(sections, ["problem", "why it matters", "implications", "content"]);
    if (problem) finding.problem = problem.trim();

    const evidence = getSectionValue(sections, ["evidence"]);
    if (evidence) {
      const parsedEvidence = extractTextAndFirstCode(evidence);
      finding.evidence = {};
      if (parsedEvidence.code) finding.evidence.code_snippet = parsedEvidence.code;
      if (parsedEvidence.text) finding.evidence.context = parsedEvidence.text;
      if (!finding.evidence.code_snippet && !finding.evidence.context) {
        delete finding.evidence;
      }
    }

    // Suggested fix parsing: section parse first, then fallback regex.
    let suggestedFixSection = getSectionValue(sections, ["suggested fix", "suggested_fix", "fix"]);
    if (!suggestedFixSection) {
      const knownLabels = [
        "Category", "Severity", "Confidence", "File", "Location", "Problem",
        "Evidence", "Attack Vector", "CWE", "OWASP", "Status", "Suggested Fix",
      ];
      const stopPattern = knownLabels.map((label) => escapeRegExp(label)).join("|");
      const fixRegex = new RegExp(
        `(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?Suggested\\s*Fix(?:\\*\\*)?\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:[-*]\\s*)?(?:\\*\\*)?(?:${stopPattern})(?:\\*\\*)?\\s*:|\\n\\s*(?:#{2,3}\\s*)?(?:ISSUE-\\d+|PERSPECTIVE-\\d+|CROSS-\\d+|RESPONSE-\\d+|VERDICT\\b)|$)`,
        "im"
      );
      const fallbackFixMatch = block.match(fixRegex);
      suggestedFixSection = fallbackFixMatch ? fallbackFixMatch[1] : "";
    }
    if (suggestedFixSection) {
      const parsedFix = extractTextAndFirstCode(suggestedFixSection);
      finding.suggested_fix = {};
      if (parsedFix.text) finding.suggested_fix.description = parsedFix.text;
      if (parsedFix.code) finding.suggested_fix.code = parsedFix.code;
      if (!finding.suggested_fix.description && finding.suggested_fix.code) {
        finding.suggested_fix.description = "Apply the suggested code change.";
      }
      if (!finding.suggested_fix.description && !finding.suggested_fix.code) {
        delete finding.suggested_fix;
      }
    }

    const refs = extractExternalRefs(block, sections);
    if (refs.length > 0) finding.external_refs = refs;

    // Default status and confidence (but not for response type)
    if (!finding.status && type !== "response") finding.status = "open";
    if (!finding.confidence) finding.confidence = "medium";

    if (type !== "issue") {
      const content = getSectionValue(sections, ["content", "problem", "evidence"]);
      const pattern = getSectionValue(sections, ["pattern"]);
      if (content && !finding.content) finding.content = content.trim();
      if (pattern) finding.pattern = pattern.trim();
    }

    // RESPONSE-specific fields (for parallel-review debate phase)
    if (type === "response") {
      const action = getSectionValue(sections, ["action"]);
      const reason = getSectionValue(sections, ["reason"]);
      if (action) {
        const normalizedAction = action.trim().toLowerCase();
        // Validate action against allowed values
        if (["accept", "reject", "revise"].includes(normalizedAction)) {
          finding.action = normalizedAction;
        } else {
          // Keep raw_action but don't set action to invalid value
          finding.raw_action = action.trim();
          finding.action_valid = false;
        }
      }
      if (reason) finding.reason = reason.trim();
      
      // Extract target from title (format: "Re: {original finding title}")
      const targetMatch = title.match(/^Re:\s*(.+)$/i);
      if (targetMatch) finding.target = targetMatch[1].trim();
      
      // Parse optional revised_finding (for action=revise)
      const revisedDesc = getSectionValue(sections, ["revised finding", "revised_finding"]);
      if (revisedDesc) {
        finding.revised_finding = { description: revisedDesc.trim() };
        // Check for revised fix within the section
        const revisedFix = getSectionValue(sections, ["revised fix", "revised_fix"]);
        if (revisedFix) {
          const parsedRevisedFix = extractTextAndFirstCode(revisedFix);
          finding.revised_finding.suggested_fix = {};
          if (parsedRevisedFix.text) finding.revised_finding.suggested_fix.description = parsedRevisedFix.text;
          if (parsedRevisedFix.code) finding.revised_finding.suggested_fix.code = parsedRevisedFix.code;
        }
      }
      
      // Parse optional counter_evidence (for action=reject)
      const counterEvidence = getSectionValue(sections, ["counter evidence", "counter_evidence", "counter-evidence"]);
      if (counterEvidence) finding.counter_evidence = counterEvidence.trim();
    }

    findings.push(finding);
  }

  if (verdictHeaderMatch) {
    let verdictType = String(verdictHeaderMatch[1] || "").trim().toUpperCase();
    if (verdictType.includes("|")) verdictType = "";

    const verdictBlockStart = verdictHeaderMatch.index + verdictHeaderMatch[0].length;
    const verdictText = text.slice(verdictBlockStart).trim();
    const verdictSections = parseLabeledSections(verdictText);

    if (!verdictType) {
      const statusRaw = getSectionValue(verdictSections, ["status", "verdict"]);
      const statusMatch = statusRaw.match(/\b(APPROVE|REVISE|COMMENT|STALEMATE)\b/i);
      if (statusMatch) verdictType = statusMatch[1].toUpperCase();
    }
    if (!verdictType) {
      const fallbackType = verdictText.match(/\b(APPROVE|REVISE|COMMENT|STALEMATE)\b/i);
      if (fallbackType) verdictType = fallbackType[1].toUpperCase();
    }
    if (!verdictType) verdictType = "COMMENT";

    let reason = getSectionValue(verdictSections, ["reason"]);
    if (!reason) {
      const rawLines = verdictText.split(/\r?\n/);
      const filtered = rawLines.filter((line) => {
        return !/^\s*(?:[-*]\s*)?(?:\*\*)?(status|reason|security risk summary|risk assessment|recommendations|blocking issues|advisory issues|conditions|next steps)(?:\*\*)?\s*:/i.test(line);
      });
      reason = filtered.join("\n").trim();
    }

    const conditionsText = getSectionValue(verdictSections, ["conditions", "blocking issues"]);
    const nextStepsText = getSectionValue(verdictSections, ["next steps", "recommendations", "advisory issues"]);
    const conditions = parseBulletList(conditionsText);
    const nextSteps = parseBulletList(nextStepsText);

    verdict = {
      verdict: verdictType,
      reason: reason || verdictText || "No additional reason provided.",
    };
    if (conditions.length > 0) verdict.conditions = conditions;
    if (nextSteps.length > 0) verdict.next_steps = nextSteps;
  }

  const reviewVerdict = verdict?.verdict || "COMMENT";
  const reviewStatus = reviewVerdict === "STALEMATE" ? "stalemate" : "complete";

  return {
    schema_version: "1.0.0",
    tool: {
      name: "codex-review",
      version: String(CODEX_RUNNER_VERSION),
      skill: meta.skill || "unknown",
      invocation: {
        working_dir: meta.working_dir || process.cwd(),
        effort: meta.effort || "medium",
        mode: meta.mode || "unknown",
        timestamp: new Date().toISOString(),
        thread_id: meta.thread_id || null,
      },
    },
    review: {
      verdict: reviewVerdict,
      status: reviewStatus,
      round: meta.round || 1,
      summary: {
        files_reviewed: meta.files_reviewed || 0,
        issues_found: findings.filter(f => f.type === 'issue').length,
        issues_fixed: 0,
        issues_disputed: 0,
      },
    },
    findings,
    verdict,
    metadata: {
      duration_seconds: meta.duration_seconds || meta.elapsed_seconds || 0,
      tokens_used: meta.tokens_used || 0,
      model: meta.model || "gpt-5.3-codex",
    },
  };
}

/**
 * Convert canonical JSON to SARIF 2.1.0 format.
 * See docs/CANONICAL_JSON_SCHEMA.md for mapping rules.
 * 
 * @param {object} canonicalJSON - Review in canonical format
 * @returns {object} SARIF 2.1.0 compliant object
 */
function convertToSARIF(canonicalJSON) {
  const severityToLevel = {
    critical: "error",
    high: "error",
    error: "error",
    medium: "warning",
    warning: "warning",
    low: "note",
    note: "note",
    info: "none",
  };
  
  // Build unique rules from findings
  const rulesMap = new Map();
  const results = [];
  
  for (const finding of canonicalJSON.findings) {
    // Skip non-issue findings (PERSPECTIVE, CROSS, RESPONSE) for SARIF
    if (finding.type !== 'issue') continue;
    
    const normalizedSeverity = normalizeSeverity(finding.severity || finding.raw_severity);
    const normalizedCategory = String(finding.category || "review-finding")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-");
    const ruleId = `${normalizedCategory}/${String(finding.id || "issue").toLowerCase()}`;
    
    // Create rule if not exists
    if (!rulesMap.has(ruleId)) {
      rulesMap.set(ruleId, {
        id: ruleId,
        shortDescription: { text: finding.category || "Review Finding" },
        fullDescription: { text: finding.title },
        helpUri: finding.external_refs?.[0]?.url || undefined
      });
    }
    
    // Build SARIF result
    const result = {
      ruleId,
      ruleIndex: Array.from(rulesMap.keys()).indexOf(ruleId),
      level: severityToLevel[normalizedSeverity] || "warning",
      message: { text: finding.title || finding.problem || "Review finding" }
    };
    
    // Add location if available
    if (finding.location?.file) {
      const region = {};
      if (Number.isInteger(finding.location.start_line)) region.startLine = finding.location.start_line;
      if (Number.isInteger(finding.location.end_line)) region.endLine = finding.location.end_line;
      if (Number.isInteger(finding.location.start_column)) region.startColumn = finding.location.start_column;
      if (Number.isInteger(finding.location.end_column)) region.endColumn = finding.location.end_column;

      const physicalLocation = {
        artifactLocation: { uri: finding.location.file },
      };
      if (Object.keys(region).length > 0) {
        physicalLocation.region = region;
      }

      result.locations = [{
        physicalLocation
      }];
    }
    
    // Add fixes if available
    if (finding.suggested_fix?.code && finding.location?.file) {
      result.fixes = [{
        description: { text: finding.suggested_fix.description || "Apply suggested fix" },
        artifactChanges: [{
          artifactLocation: { uri: finding.location.file },
          replacements: [{
            deletedRegion: {
              startLine: finding.location?.start_line || 1,
              endLine: finding.location?.end_line || finding.location?.start_line || 1
            },
            insertedContent: { text: finding.suggested_fix.code }
          }]
        }]
      }];
    }
    
    // Add properties
    result.properties = {
      confidence: finding.confidence,
      category: finding.category,
      status: finding.status,
      normalized_severity: normalizedSeverity,
    };
    
    if (finding.external_refs) {
      result.properties.external_refs = finding.external_refs;
    }
    
    results.push(result);
  }
  
  // Build SARIF document
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: {
        driver: {
          name: canonicalJSON.tool.name,
          version: canonicalJSON.tool.version,
          informationUri: "https://github.com/lploc94/codex_skill",
          rules: Array.from(rulesMap.values())
        }
      },
      results,
      invocations: [{
        executionSuccessful: canonicalJSON.review.status === "complete",
        workingDirectory: {
          uri: pathToFileURL(canonicalJSON.tool.invocation.working_dir || process.cwd()).href
        }
      }]
    }]
  };
}

/**
 * Convert canonical JSON to human-readable Markdown.
 * See docs/CANONICAL_JSON_SCHEMA.md for rendering guidelines.
 * 
 * @param {object} canonicalJSON - Review in canonical format
 * @returns {string} Formatted markdown string
 */
function convertToMarkdown(canonicalJSON) {
  const lines = [];
  
  // Header
  lines.push("# Code Review Results\n");
  lines.push(`**Verdict**: ${canonicalJSON.review.verdict}`);
  lines.push(`**Status**: ${canonicalJSON.review.status} (Round ${canonicalJSON.review.round})`);
  lines.push(`**Files Reviewed**: ${canonicalJSON.review.summary.files_reviewed}`);
  lines.push(`**Issues Found**: ${canonicalJSON.review.summary.issues_found} (${canonicalJSON.review.summary.issues_fixed} fixed, ${canonicalJSON.review.summary.issues_found - canonicalJSON.review.summary.issues_fixed} open)\n`);
  lines.push("---\n");
  
  // Group findings by severity
  const severityOrder = ["critical", "high", "medium", "low", "info"];
  const severityLabel = {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    low: "Low",
    info: "Info"
  };
  
  const findingsBySeverity = {};
  const otherFindings = [];
  
  for (const finding of canonicalJSON.findings) {
    const severity = normalizeSeverity(finding.severity || finding.raw_severity);
    if (finding.type === "issue" && severity) {
      if (!findingsBySeverity[severity]) {
        findingsBySeverity[severity] = [];
      }
      findingsBySeverity[severity].push(finding);
    } else {
      otherFindings.push(finding);
    }
  }
  
  // Render findings by severity
  for (const severity of severityOrder) {
    const findings = findingsBySeverity[severity];
    if (!findings || findings.length === 0) continue;
    
    const label = severityLabel[severity] || severity;
    lines.push(`## ${label} Issues (${findings.length})\n`);
    
    for (const finding of findings) {
      lines.push(`### ${finding.id}: ${finding.title}`);
      lines.push(`- **Category**: ${finding.category}`);
      lines.push(`- **Severity**: ${severity}`);
      if (finding.location) {
        const loc = finding.location;
        const locStr = loc.start_line ? `${loc.file}:${loc.start_line}${loc.end_line && loc.end_line !== loc.start_line ? `-${loc.end_line}` : ''}` : loc.file;
        lines.push(`- **File**: \`${locStr}\``);
      }
      lines.push(`- **Confidence**: ${finding.confidence}`);
      if (finding.status) {
        lines.push(`- **Status**: ${finding.status}`);
      }
      lines.push("");
      
      if (finding.problem) {
        lines.push(`**Problem**: ${finding.problem}\n`);
      }
      
      if (finding.evidence?.code_snippet) {
        lines.push("**Evidence**:");
        lines.push("```");
        lines.push(finding.evidence.code_snippet);
        lines.push("```\n");
      } else if (finding.evidence?.context) {
        lines.push(`**Evidence**: ${finding.evidence.context}\n`);
      }
      
      if (finding.suggested_fix) {
        lines.push(`**Suggested Fix**: ${finding.suggested_fix.description}`);
        if (finding.suggested_fix.code) {
          lines.push("```");
          lines.push(finding.suggested_fix.code);
          lines.push("```");
        }
        lines.push("");
      }
      
      if (finding.external_refs && finding.external_refs.length > 0) {
        lines.push("**References**:");
        for (const ref of finding.external_refs) {
          const label = ref.type === 'cwe' ? `CWE-${ref.id.replace('CWE-', '')}` : ref.id;
          lines.push(`- [${label}](${ref.url})`);
        }
        lines.push("");
      }
      
      lines.push("---\n");
    }
  }

  // Do not drop unknown severities.
  const unknownSeverities = Object.keys(findingsBySeverity).filter((sev) => !severityOrder.includes(sev));
  for (const severity of unknownSeverities) {
    const findings = findingsBySeverity[severity];
    if (!findings || findings.length === 0) continue;
    lines.push(`## ${severity} Issues (${findings.length})\n`);
    for (const finding of findings) {
      lines.push(`### ${finding.id}: ${finding.title}`);
      lines.push(`- **Category**: ${finding.category || "unknown"}`);
      lines.push(`- **Severity**: ${severity}`);
      lines.push(`- **Confidence**: ${finding.confidence || "medium"}`);
      lines.push("");
      if (finding.problem) lines.push(`**Problem**: ${finding.problem}\n`);
      lines.push("---\n");
    }
  }
  
  // Render other findings (PERSPECTIVE, CROSS, RESPONSE)
  if (otherFindings.length > 0) {
    lines.push("## Other Findings\n");
    for (const finding of otherFindings) {
      lines.push(`### ${finding.id}: ${finding.title}`);
      lines.push(`- **Type**: ${finding.type}`);
      lines.push(`- **Confidence**: ${finding.confidence}\n`);
      
      // RESPONSE-specific rendering
      if (finding.type === "response") {
        if (finding.action) {
          lines.push(`**Action**: ${finding.action}`);
        } else if (finding.raw_action) {
          lines.push(`**Action**: ${finding.raw_action} (invalid - must be accept/reject/revise)`);
        }
        if (finding.reason) lines.push(`**Reason**: ${finding.reason}`);
        if (finding.target) lines.push(`**Target**: ${finding.target}`);
        
        // Render revised_finding if action=revise
        if (finding.revised_finding) {
          lines.push("\n**Revised Finding**:");
          if (finding.revised_finding.description) {
            lines.push(finding.revised_finding.description);
          }
          if (finding.revised_finding.suggested_fix) {
            lines.push("\n**Revised Fix**:");
            if (finding.revised_finding.suggested_fix.description) {
              lines.push(finding.revised_finding.suggested_fix.description);
            }
            if (finding.revised_finding.suggested_fix.code) {
              lines.push("```");
              lines.push(finding.revised_finding.suggested_fix.code);
              lines.push("```");
            }
          }
        }
        
        // Render counter_evidence if action=reject
        if (finding.counter_evidence) {
          lines.push("\n**Counter Evidence**:");
          lines.push(finding.counter_evidence);
        }
        
        lines.push("");
      }
      
      if (finding.content) {
        lines.push(finding.content);
        lines.push("");
      }
      
      if (finding.pattern) {
        lines.push(`**Pattern**: ${finding.pattern}\n`);
      }
      
      lines.push("---\n");
    }
  }
  
  // Verdict section
  if (canonicalJSON.verdict) {
    lines.push("## Verdict\n");
    lines.push(`**${canonicalJSON.verdict.verdict}**\n`);
    lines.push(canonicalJSON.verdict.reason);
    lines.push("");
    
    if (canonicalJSON.verdict.conditions && canonicalJSON.verdict.conditions.length > 0) {
      lines.push("\n**Conditions**:");
      for (const condition of canonicalJSON.verdict.conditions) {
        lines.push(`- ${condition}`);
      }
      lines.push("");
    }
    
    if (canonicalJSON.verdict.next_steps && canonicalJSON.verdict.next_steps.length > 0) {
      lines.push("\n**Next Steps**:");
      for (const step of canonicalJSON.verdict.next_steps) {
        lines.push(`- ${step}`);
      }
      lines.push("");
    }
  }
  
  // Metadata footer
  lines.push("\n---\n");
  lines.push("**Review Metadata**:");
  lines.push(`- Skill: ${canonicalJSON.tool.skill}`);
  lines.push(`- Duration: ${canonicalJSON.metadata.duration_seconds}s`);
  lines.push(`- Model: ${canonicalJSON.metadata.model}`);
  lines.push(`- Timestamp: ${canonicalJSON.tool.invocation.timestamp}`);
  
  return lines.join('\n');
}

/**
 * Write review outputs in requested format(s).
 * 
 * @param {string} stateDir - State directory path
 * @param {string} markdownOutput - Raw Codex markdown output
 * @param {object} metadata - Review metadata
 * @param {string} format - Output format: markdown|json|sarif|both
 */
function writeReviewOutputs(stateDir, markdownOutput, metadata, format) {
  // ALWAYS write review.txt for backward compatibility (all formats)
  fs.writeFileSync(path.join(stateDir, "review.txt"), markdownOutput, "utf8");
  
  // If markdown only, we're done
  if (format === "markdown" || !format) {
    return;
  }
  
  // Convert to JSON/SARIF formats
  if (format === "json" || format === "sarif" || format === "both") {
    try {
      const canonicalJSON = parseToCanonicalJSON(markdownOutput, metadata);
      
      // Write canonical JSON
      if (format === "json" || format === "both") {
        fs.writeFileSync(
          path.join(stateDir, "review.json"),
          JSON.stringify(canonicalJSON, null, 2),
          "utf8"
        );
      }
      
      // Write SARIF
      if (format === "sarif" || format === "both") {
        const sarif = convertToSARIF(canonicalJSON);
        fs.writeFileSync(
          path.join(stateDir, "review.sarif.json"),
          JSON.stringify(sarif, null, 2),
          "utf8"
        );
      }
      
      // Write rendered Markdown (from JSON, not original)
      if (format === "both") {
        const renderedMarkdown = convertToMarkdown(canonicalJSON);
        fs.writeFileSync(
          path.join(stateDir, "review.md"),
          renderedMarkdown,
          "utf8"
        );
      }
    } catch (err) {
      // Fallback already written (review.txt)
      process.stderr.write(`Warning: Format conversion failed: ${err.message}\n`);
      if (err && err.stack) process.stderr.write(`Stack trace: ${err.stack}\n`);
      
      // Write error placeholder
      const errorPlaceholder = {
        error: "Format conversion failed",
        message: err.message,
        requested_format: format,
        fallback: "review.txt contains original markdown output"
      };
      
      if (format === "json" || format === "both") {
        fs.writeFileSync(
          path.join(stateDir, "review.json"),
          JSON.stringify(errorPlaceholder, null, 2),
          "utf8"
        );
      }
      
      if (format === "sarif" || format === "both") {
        const sarifError = buildSarifErrorDocument(err.message, {
          tool: {
            name: "codex-review",
            version: String(CODEX_RUNNER_VERSION),
          },
        });
        fs.writeFileSync(
          path.join(stateDir, "review.sarif.json"),
          JSON.stringify(sarifError, null, 2),
          "utf8"
        );
      }
    }
  }
}

// ============================================================
// Process management
// ============================================================

/**
 * Resolve the codex CLI command for spawning.
 *
 * On Windows, npm-installed CLIs are .cmd wrappers (e.g. codex.cmd).
 * Node.js spawn() cannot resolve .cmd files without shell: true,
 * but shell: true + detached: true drops stdio on Windows.
 * Instead, resolve the underlying codex.js entry point and invoke
 * it directly via node.exe — no shell needed.
 */
function resolveCodexCommand() {
  if (!IS_WIN) {
    return { cmd: "codex", prependArgs: [] };
  }

  // Try to find codex.js via npm global prefix
  const r = spawnSync("npm", ["config", "get", "prefix"], {
    encoding: "utf8",
    shell: true,
    timeout: 10000,
  });
  if (r.status === 0 && r.stdout) {
    const prefix = r.stdout.trim();
    const codexJs = path.join(
      prefix, "node_modules", "@openai", "codex", "bin", "codex.js",
    );
    if (fs.existsSync(codexJs)) {
      return { cmd: process.execPath, prependArgs: [codexJs] };
    }
  }

  // Fallback: try common npm global path on Windows
  const appData = process.env.APPDATA;
  if (appData) {
    const codexJs = path.join(
      appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js",
    );
    if (fs.existsSync(codexJs)) {
      return { cmd: process.execPath, prependArgs: [codexJs] };
    }
  }

  // Last resort: assume "codex" is directly executable (non-npm install)
  return { cmd: "codex", prependArgs: [] };
}

function launchCodex(stateDir, workingDir, timeoutS, threadId, effort) {
  const promptFile = path.join(stateDir, "prompt.txt");
  const jsonlFile = path.join(stateDir, "output.jsonl");
  const errFile = path.join(stateDir, "error.log");

  const { cmd: resolvedCmd, prependArgs } = resolveCodexCommand();
  let cmd = resolvedCmd;
  let args;
  let cwd;

  if (threadId) {
    args = [...prependArgs, "exec", "--skip-git-repo-check", "--json", "resume", threadId];
    cwd = workingDir;
  } else {
    args = [
      ...prependArgs,
      "exec", "--skip-git-repo-check", "--json",
      "--sandbox", "read-only",
      "--config", `model_reasoning_effort=${effort}`,
      "-C", workingDir,
    ];
    cwd = undefined;
  }

  const fin = fs.openSync(promptFile, "r");
  const fout = fs.openSync(jsonlFile, "w");
  const ferr = fs.openSync(errFile, "w");

  const spawnOpts = {
    stdio: [fin, fout, ferr],
    detached: true,
    cwd,
  };

  if (IS_WIN) {
    spawnOpts.windowsHide = true;
  }

  const child = spawn(cmd, args, spawnOpts);
  child.unref();

  const pid = child.pid;

  if (pid === undefined) {
    throw new Error(`Failed to spawn "${cmd}" — process did not start (ENOENT). Is codex installed globally?`);
  }

  // Close file descriptors in parent
  fs.closeSync(fin);
  fs.closeSync(fout);
  fs.closeSync(ferr);

  return { pid, pgid: pid };
}

function isAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killTree(pid) {
  try {
    if (IS_WIN) {
      spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], {
        stdio: "ignore",
      });
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    // Process already dead
  }
}

function killSingle(pid) {
  try {
    if (IS_WIN) {
      spawnSync("taskkill", ["/F", "/PID", String(pid)], {
        stdio: "ignore",
      });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // Process already dead
  }
}

function getCmdline(pid) {
  try {
    if (IS_WIN) {
      // Try PowerShell first
      try {
        const result = spawnSync(
          "powershell",
          ["-NoProfile", "-Command",
           `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
          { encoding: "utf8", timeout: 10000 },
        );
        const cmdline = (result.stdout || "").trim();
        if (cmdline) return cmdline;
      } catch {
        // PowerShell not available
      }
      // Fallback to wmic
      try {
        const result = spawnSync(
          "wmic",
          ["process", "where", `ProcessId=${pid}`, "get", "CommandLine", "/value"],
          { encoding: "utf8", timeout: 5000 },
        );
        for (const line of (result.stdout || "").split("\n")) {
          if (line.startsWith("CommandLine=")) {
            return line.slice("CommandLine=".length).trim();
          }
        }
      } catch {
        // wmic not available
      }
      return null;
    }

    // Unix
    const result = spawnSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
      timeout: 5000,
    });
    return result.status === 0 ? (result.stdout || "").trim() : null;
  } catch {
    return null;
  }
}

function verifyCodex(pid) {
  if (!isAlive(pid)) return "dead";
  const cmdline = getCmdline(pid);
  if (cmdline === null) return "unknown";
  if (cmdline.includes("codex exec") || cmdline.includes("codex.exe exec") || cmdline.includes("codex.js") && cmdline.includes("exec")) {
    return "verified";
  }
  return "mismatch";
}

function verifyWatchdog(pid) {
  if (!isAlive(pid)) return "dead";
  const cmdline = getCmdline(pid);
  if (cmdline === null) return "unknown";
  if (cmdline.includes("node") && cmdline.includes("_watchdog")) {
    return "verified";
  }
  return "mismatch";
}

function launchWatchdog(timeoutS, targetPid) {
  const script = path.resolve(__filename);
  const nodeExe = process.execPath;
  const args = [script, "_watchdog", String(timeoutS), String(targetPid)];

  const spawnOpts = {
    stdio: "ignore",
    detached: true,
  };
  if (IS_WIN) {
    spawnOpts.windowsHide = true;
  }

  const child = spawn(nodeExe, args, spawnOpts);
  child.unref();
  return child.pid;
}

// ============================================================
// File I/O
// ============================================================

function atomicWrite(filepath, content) {
  const dirpath = path.dirname(filepath);
  const tmpPath = path.join(dirpath, `.${path.basename(filepath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, content, "utf8");
    fs.renameSync(tmpPath, filepath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

function readState(stateDir) {
  const stateFile = path.join(stateDir, "state.json");
  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

function updateState(stateDir, updates) {
  const state = readState(stateDir);
  Object.assign(state, updates);
  atomicWrite(path.join(stateDir, "state.json"), JSON.stringify(state, null, 2));
  return state;
}

// ============================================================
// JSONL parsing
// ============================================================

function parseJsonl(stateDir, lastLineCount, elapsed, processAlive, timeoutVal, state) {
  const jsonlFile = path.join(stateDir, "output.jsonl");
  const errFile = path.join(stateDir, "error.log");

  let allLines = [];
  if (fs.existsSync(jsonlFile)) {
    const content = fs.readFileSync(jsonlFile, "utf8");
    allLines = content.split("\n");
  }

  let turnCompleted = false;
  let turnFailed = false;
  let turnFailedMsg = "";
  let extractedThreadId = "";
  let reviewText = "";

  // Parse ALL lines for terminal state + data extraction
  for (const rawLine of allLines) {
    const line = rawLine.trim();
    if (!line) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const t = d.type || "";

    if (t === "thread.started" && d.thread_id) {
      extractedThreadId = d.thread_id;
    }

    if (t === "turn.completed") {
      turnCompleted = true;
    } else if (t === "turn.failed") {
      turnFailed = true;
      turnFailedMsg = (d.error && d.error.message) || "unknown error";
    }

    if (t === "item.completed") {
      const item = d.item || {};
      if (item.type === "agent_message") {
        reviewText = item.text || "";
      }
    }
  }

  // Parse NEW lines for progress events
  const stderrLines = [];
  const newLines = allLines.slice(lastLineCount);
  for (const rawLine of newLines) {
    const line = rawLine.trim();
    if (!line) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const t = d.type || "";
    const item = d.item || {};
    const itemType = item.type || "";

    if (t === "turn.started") {
      stderrLines.push(`[${elapsed}s] Codex is thinking...`);
    } else if (t === "item.completed" && itemType === "reasoning") {
      let text = item.text || "";
      if (text.length > 150) text = text.slice(0, 150) + "...";
      stderrLines.push(`[${elapsed}s] Codex thinking: ${text}`);
    } else if (t === "item.started" && itemType === "command_execution") {
      stderrLines.push(`[${elapsed}s] Codex running: ${item.command || ""}`);
    } else if (t === "item.completed" && itemType === "command_execution") {
      stderrLines.push(`[${elapsed}s] Codex completed: ${item.command || ""}`);
    } else if (t === "item.completed" && itemType === "file_change") {
      for (const c of (item.changes || [])) {
        stderrLines.push(`[${elapsed}s] Codex changed: ${c.path || "?"} (${c.kind || "?"})`);
      }
    }
  }

  function sanitizeMsg(s) {
    if (s == null) return "unknown error";
    return String(s).replace(/\s+/g, " ").trim();
  }

  // Determine status
  const stdoutParts = [];
  if (turnCompleted) {
    if (!extractedThreadId || !reviewText) {
      const errorDetail = !extractedThreadId ? "no thread_id" : "no agent_message";
      stdoutParts.push(`POLL:failed:${elapsed}s:1:turn.completed but ${errorDetail}`);
    } else {
      // Write review outputs in requested format(s)
      const format = (state && state.format) || "markdown";
      const metadata = {
        skill: "codex-review",
        effort: (state && state.effort) || "high",
        working_dir: (state && state.working_dir) || "",
        thread_id: extractedThreadId,
        duration_seconds: elapsed
      };
      
      try {
        writeReviewOutputs(stateDir, reviewText, metadata, format);
      } catch (err) {
        // Fallback: always write review.txt for backward compatibility
        const reviewPath = path.join(stateDir, "review.txt");
        fs.writeFileSync(reviewPath, reviewText, "utf8");
        process.stderr.write(`Warning: Format conversion failed: ${err.message}\n`);
      }
      
      stdoutParts.push(`POLL:completed:${elapsed}s`);
      stdoutParts.push(`THREAD_ID:${extractedThreadId}`);
    }
  } else if (turnFailed) {
    stdoutParts.push(`POLL:failed:${elapsed}s:3:Codex turn failed: ${sanitizeMsg(turnFailedMsg)}`);
  } else if (!processAlive) {
    if (timeoutVal > 0 && elapsed >= timeoutVal) {
      stdoutParts.push(`POLL:timeout:${elapsed}s:2:Timeout after ${timeoutVal}s`);
    } else {
      let errContent = "";
      if (fs.existsSync(errFile)) {
        errContent = fs.readFileSync(errFile, "utf8").trim();
      }
      let errorMsg = "Codex process exited unexpectedly";
      if (errContent) {
        errorMsg += ": " + sanitizeMsg(errContent.slice(0, 200));
      }
      stdoutParts.push(`POLL:failed:${elapsed}s:1:${errorMsg}`);
    }
  } else {
    stdoutParts.push(`POLL:running:${elapsed}s`);
  }

  return { stdoutOutput: stdoutParts.join("\n"), stderrLines };
}

// ============================================================
// Validation helpers
// ============================================================

function validateStateDir(stateDir) {
  let resolved;
  try {
    resolved = fs.realpathSync(stateDir);
  } catch {
    return { dir: null, err: "Invalid or missing state directory" };
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return { dir: null, err: "Invalid or missing state directory" };
  }

  const stateFile = path.join(resolved, "state.json");
  if (!fs.existsSync(stateFile)) {
    return { dir: null, err: "state.json not found" };
  }

  // Reconstruct expected path from state.json and compare
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const wd = fs.realpathSync(s.working_dir || "");
    const rid = s.run_id || "";
    const expected = path.join(wd, ".codex-review", "runs", rid);
    const actual = fs.realpathSync(resolved);
    if (expected !== actual) {
      return { dir: null, err: "state directory path mismatch" };
    }
  } catch {
    return { dir: null, err: "state.json validation error" };
  }

  return { dir: resolved, err: null };
}

function verifyAndKillCodex(pid, pgid) {
  if (!pid || pid <= 1 || !pgid || pgid <= 1) return;
  const status = verifyCodex(pid);
  if (status === "verified" || status === "unknown") {
    killTree(pgid);
  }
}

function verifyAndKillWatchdog(pid) {
  if (!pid || pid <= 1) return;
  const status = verifyWatchdog(pid);
  if (status === "verified" || status === "unknown") {
    killSingle(pid);
  }
}

// ============================================================
// Stdin reading
// ============================================================

function readStdinSync() {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  let bytesRead;
  try {
    while (true) {
      bytesRead = fs.readSync(0, buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      chunks.push(Buffer.from(buf.slice(0, bytesRead)));
    }
  } catch {
    // EOF or pipe closed
  }
  return Buffer.concat(chunks).toString("utf8");
}

// ============================================================
// Subcommands
// ============================================================

function cmdStart(argv) {
  // Parse arguments
  const { values } = parseArgs({
    args: argv,
    options: {
      "working-dir": { type: "string" },
      effort: { type: "string", default: "high" },
      "thread-id": { type: "string", default: "" },
      timeout: { type: "string", default: "3600" },
      format: { type: "string", default: "markdown" },
    },
    strict: true,
  });

  const workingDir = values["working-dir"];
  const effort = values.effort || "high";
  const threadId = values["thread-id"] || "";
  const timeout = parseInt(values.timeout || "3600", 10);
  const format = values.format || "markdown";

  // Validate format parameter
  const validFormats = ["markdown", "json", "sarif", "both"];
  if (!validFormats.includes(format)) {
    process.stderr.write(`Error: invalid format '${format}'. Valid options: ${validFormats.join(", ")}\n`);
    return EXIT_ERROR;
  }

  if (!workingDir) {
    process.stderr.write("Error: --working-dir is required\n");
    return EXIT_ERROR;
  }

  // Check codex in PATH
  const whichCmd = IS_WIN ? "where" : "which";
  const probe = spawnSync(whichCmd, ["codex"], { encoding: "utf8" });
  if (probe.status !== 0) {
    process.stderr.write("Error: codex CLI not found in PATH\n");
    return EXIT_CODEX_NOT_FOUND;
  }

  let resolvedWorkingDir;
  try {
    resolvedWorkingDir = fs.realpathSync(workingDir);
  } catch {
    process.stderr.write(`Error: working directory does not exist: ${workingDir}\n`);
    return EXIT_ERROR;
  }

  // Read prompt from stdin
  const prompt = readStdinSync();
  if (!prompt.trim()) {
    process.stderr.write("Error: no prompt provided on stdin\n");
    return EXIT_ERROR;
  }

  // Create state directory
  const runId = `${Math.floor(Date.now() / 1000)}-${process.pid}`;
  const stateDir = path.join(resolvedWorkingDir, ".codex-review", "runs", runId);
  fs.mkdirSync(stateDir, { recursive: true });

  // Write prompt
  fs.writeFileSync(path.join(stateDir, "prompt.txt"), prompt, "utf8");

  // Track for rollback
  let codexPgid = null;
  let watchdogPid = null;

  function startupCleanup() {
    if (codexPgid !== null) {
      killTree(codexPgid);
    }
    if (watchdogPid !== null && isAlive(watchdogPid)) {
      killSingle(watchdogPid);
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  }

  try {
    // Launch Codex
    const { pid: codexPid, pgid } = launchCodex(
      stateDir, resolvedWorkingDir, timeout, threadId, effort,
    );
    codexPgid = pgid;

    // Launch watchdog
    watchdogPid = launchWatchdog(timeout, codexPgid);

    // Write state.json atomically
    const now = Math.floor(Date.now() / 1000);
    const state = {
      pid: codexPid,
      pgid: codexPgid,
      watchdog_pid: watchdogPid,
      run_id: runId,
      state_dir: stateDir,
      working_dir: resolvedWorkingDir,
      effort,
      timeout,
      format,
      started_at: now,
      thread_id: threadId,
      last_line_count: 0,
      stall_count: 0,
      last_poll_at: 0,
    };
    atomicWrite(path.join(stateDir, "state.json"), JSON.stringify(state, null, 2));
  } catch (e) {
    process.stderr.write(`Error: ${e.message}\n`);
    startupCleanup();
    return EXIT_ERROR;
  }

  // Success
  process.stdout.write(`CODEX_STARTED:${stateDir}\n`);
  return EXIT_SUCCESS;
}

function cmdPoll(argv) {
  const stateDirArg = argv[0];
  if (!stateDirArg) {
    process.stdout.write("POLL:failed:0s:1:Invalid or missing state directory\n");
    return EXIT_ERROR;
  }

  const { dir: stateDir, err } = validateStateDir(stateDirArg);
  if (err) {
    process.stdout.write(`POLL:failed:0s:1:${err}\n`);
    return EXIT_ERROR;
  }

  // Check for cached final result
  const finalFile = path.join(stateDir, "final.txt");
  if (fs.existsSync(finalFile)) {
    const cached = fs.readFileSync(finalFile, "utf8");
    process.stdout.write(cached);
    if (!cached.endsWith("\n")) process.stdout.write("\n");
    const reviewFile = path.join(stateDir, "review.txt");
    if (fs.existsSync(reviewFile)) {
      process.stderr.write(`[cached] Review available in ${stateDir}/review.txt\n`);
    }
    return EXIT_SUCCESS;
  }

  // Read state
  const state = readState(stateDir);
  const codexPid = state.pid || 0;
  const codexPgid = state.pgid || 0;
  const watchdogPid = state.watchdog_pid || 0;
  const timeoutVal = state.timeout || 3600;
  const startedAt = state.started_at || Math.floor(Date.now() / 1000);
  const lastLineCount = state.last_line_count || 0;
  const stallCount = state.stall_count || 0;

  const now = Math.floor(Date.now() / 1000);
  const elapsed = now - startedAt;

  // Check if process is alive
  const processAlive = isAlive(codexPid);

  // Count lines
  const jsonlFile = path.join(stateDir, "output.jsonl");
  let currentLineCount = 0;
  if (fs.existsSync(jsonlFile)) {
    const content = fs.readFileSync(jsonlFile, "utf8");
    currentLineCount = content.split("\n").filter((l) => l.trim()).length;
  }

  // Stall detection
  const newStallCount = currentLineCount === lastLineCount
    ? stallCount + 1
    : 0;

  // Parse JSONL
  let { stdoutOutput: pollOutput, stderrLines } = parseJsonl(
    stateDir, lastLineCount, elapsed, processAlive, timeoutVal, state
  );

  // Print progress to stderr
  for (const line of stderrLines) {
    process.stderr.write(line + "\n");
  }

  // Determine poll status from first line
  const firstLine = pollOutput.split("\n")[0] || "";
  const parts = firstLine.split(":");
  let pollStatus = parts.length >= 2 ? parts[1] : "";

  function writeFinalAndCleanup(content) {
    atomicWrite(path.join(stateDir, "final.txt"), content);
    verifyAndKillCodex(codexPid, codexPgid);
    if (watchdogPid) {
      verifyAndKillWatchdog(watchdogPid);
    }
  }

  if (pollStatus !== "running") {
    writeFinalAndCleanup(pollOutput);
  } else {
    // Check timeout/stall only when still running
    if (elapsed >= timeoutVal) {
      pollOutput = `POLL:timeout:${elapsed}s:${EXIT_TIMEOUT}:Timeout after ${timeoutVal}s`;
      writeFinalAndCleanup(pollOutput);
    } else if (newStallCount >= 12 && processAlive) {
      pollOutput = `POLL:stalled:${elapsed}s:${EXIT_STALLED}:No new output for ~3 minutes`;
      writeFinalAndCleanup(pollOutput);
    }
  }

  // Update state.json
  updateState(stateDir, {
    last_line_count: currentLineCount,
    stall_count: newStallCount,
    last_poll_at: now,
  });

  process.stdout.write(pollOutput + "\n");
  return EXIT_SUCCESS;
}

function cmdStop(argv) {
  const stateDirArg = argv[0];
  if (!stateDirArg) {
    process.stderr.write("Error: state directory argument required\n");
    return EXIT_ERROR;
  }

  const { dir: stateDir, err } = validateStateDir(stateDirArg);
  if (err) {
    process.stderr.write(`Error: ${err}\n`);
    return EXIT_ERROR;
  }

  // Read state and kill processes
  try {
    const state = readState(stateDir);
    const codexPid = state.pid || 0;
    const codexPgid = state.pgid || 0;
    const watchdogPid = state.watchdog_pid || 0;

    if (codexPid && codexPgid) {
      verifyAndKillCodex(codexPid, codexPgid);
    }
    if (watchdogPid) {
      verifyAndKillWatchdog(watchdogPid);
    }
  } catch {
    // State may be corrupted, proceed to cleanup
  }

  // Remove state directory
  fs.rmSync(stateDir, { recursive: true, force: true });
  return EXIT_SUCCESS;
}

function cmdWatchdog(argv) {
  const timeoutS = parseInt(argv[0], 10);
  const targetPid = parseInt(argv[1], 10);

  if (isNaN(timeoutS) || isNaN(targetPid)) {
    process.stderr.write("Error: _watchdog requires <timeout> <pid>\n");
    return EXIT_ERROR;
  }

  // Detach from parent session on Unix
  if (!IS_WIN) {
    try {
      process.setsid && process.setsid();
    } catch {
      // setsid may not be available in all Node.js builds
    }
  }

  // Use setTimeout to wait, then kill target
  setTimeout(() => {
    killTree(targetPid);
    process.exit(EXIT_SUCCESS);
  }, timeoutS * 1000);

  // Keep the process alive
  return -1; // Signal: don't exit immediately
}

// ============================================================
// CLI
// ============================================================

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] || "";
  const rest = argv.slice(1);

  let exitCode;

  switch (command) {
    case "version":
      process.stdout.write(`${CODEX_RUNNER_VERSION}\n`);
      exitCode = EXIT_SUCCESS;
      break;
    case "start":
      exitCode = cmdStart(rest);
      break;
    case "poll":
      exitCode = cmdPoll(rest);
      break;
    case "stop":
      exitCode = cmdStop(rest);
      break;
    case "_watchdog":
      exitCode = cmdWatchdog(rest);
      break;
    default:
      process.stderr.write(
        "codex-runner.js — Cross-platform runner for Codex CLI\n\n" +
        "Usage:\n" +
        "  node codex-runner.js version\n" +
        "  node codex-runner.js start --working-dir <dir> [--effort <level>] [--thread-id <id>] [--timeout <s>] [--format <markdown|json|sarif|both>]\n" +
        "  node codex-runner.js poll <state_dir>\n" +
        "  node codex-runner.js stop <state_dir>\n",
      );
      exitCode = command ? EXIT_ERROR : EXIT_SUCCESS;
      break;
  }

  // _watchdog returns -1 to keep process alive
  if (exitCode >= 0) {
    process.exit(exitCode);
  }
}

main();
