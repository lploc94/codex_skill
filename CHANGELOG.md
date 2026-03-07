# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Smart file filtering instructions in review prompts
  - Plan-review: Skip test files by default, focus on implementation files
  - Impl-review: Light review of test changes, focus on business logic
  - Reduces unnecessary file reads by 40-60%
- Effort level presets documentation with time estimates
  - `low`: 2-5 min (quick sanity check)
  - `medium`: 5-10 min (balanced, recommended)
  - `high`: 10-20 min (thorough analysis)
  - `xhigh`: 20-40 min (exhaustive review)
- Enhanced progress reporting guidelines in workflow
  - File counter tracking
  - Progress grouped by file type
  - Cumulative progress display
  - Remaining time estimation

### Changed
- Review prompts now include file reading strategy for performance optimization

### Performance
- Reduced unnecessary file reads through smart filtering (40-60% fewer files)
- Effort presets allow users to control review depth vs speed tradeoff

## [9.0.0] - 2024-03-07

### Changed
- Migrated from shell scripts to Node.js runner (codex-runner.js)
- Cross-platform support (Windows, macOS, Linux)
- Improved process management and cleanup
- Better error handling and status reporting

### Added
- Version command for runner
- Atomic state management
- PID verification before process termination
- Stall detection mechanism

## Earlier versions

See git history for changes prior to version 9.0.0.
