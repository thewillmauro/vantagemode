#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install HTML validation tools (cached after first run)
if ! command -v npx &> /dev/null; then
  echo "npx not available, skipping linter install"
  exit 0
fi

# Install html-validate for linting the single-file site
npm list -g html-validate &> /dev/null || npm install -g html-validate

echo "Session start hook completed successfully"
