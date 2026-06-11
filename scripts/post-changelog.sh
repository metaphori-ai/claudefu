#!/bin/bash
# Post a specific version's changelog to Slack
# Usage: ./scripts/post-changelog.sh v0.4.17

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if version argument provided
if [ -z "$1" ]; then
    echo -e "${RED}Usage: ./scripts/post-changelog.sh v0.4.17${NC}"
    exit 1
fi

VERSION=$1
VERSION_NUM=${VERSION#v}  # Strip 'v' prefix for version number

# Load .env file if it exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
if [ -f "$REPO_ROOT/.env" ]; then
    export $(grep -v '^#' "$REPO_ROOT/.env" | xargs)
fi

# Check if SLACK_WEBHOOK is configured
if [ -z "$SLACK_WEBHOOK" ]; then
    echo -e "${RED}Error: SLACK_WEBHOOK not set (check .env)${NC}"
    exit 1
fi

# Extract changelog for this version (between ## [version] and next ## [)
CHANGELOG_SECTION=$(awk "/^## \[$VERSION_NUM\]/{flag=1; next} /^## \[/{flag=0} flag" "$REPO_ROOT/CHANGELOG.md")

if [ -z "$CHANGELOG_SECTION" ]; then
    echo -e "${RED}Error: Could not extract changelog for version $VERSION_NUM${NC}"
    echo "Available versions:"
    grep '^## \[' "$REPO_ROOT/CHANGELOG.md" | head -5
    exit 1
fi

echo -e "${YELLOW}Posting changelog for $VERSION to Slack...${NC}"

# --- post_section: chunked Slack section poster ---
# Slack's `section` block has a 3000-character text limit. Long ### bodies
# (e.g. v0.5.54+) get rejected with `invalid_blocks`. This helper splits a
# section's body on paragraph boundaries (\n\n preferred), hard-cuts any
# single paragraph that exceeds the limit, and posts each chunk as its own
# section block. The first chunk carries the header prefix; continuations
# are plain. Slack renders them as adjacent blocks visually contiguous.
post_section() {
    local header="$1"
    local body="$2"
    local max_chunk=2800   # 3000 - room for *header*\n prefix + safety margin

    # Use awk to chunk on paragraph boundaries. Records = paragraphs (RS='\n\n').
    # Single paragraphs > max get hard-split. Output: chunks separated by \x1F.
    local chunks
    chunks=$(printf '%s' "$body" | awk -v max="$max_chunk" '
    BEGIN { RS="\n\n"; ORS=""; chunk="" }
    {
        rec=$0
        # If a single paragraph exceeds max, flush current chunk and hard-split
        if (length(rec) > max) {
            if (chunk != "") { print chunk "\x1F"; chunk="" }
            while (length(rec) > max) {
                print substr(rec, 1, max) "\x1F"
                rec = substr(rec, max+1)
            }
            chunk = rec
        } else if (chunk == "") {
            chunk = rec
        } else if (length(chunk) + length(rec) + 2 <= max) {
            chunk = chunk "\n\n" rec
        } else {
            print chunk "\x1F"
            chunk = rec
        }
    }
    END { if (chunk != "") print chunk }
    ')

    local first=true
    while IFS= read -r -d $'\x1F' chunk || [ -n "$chunk" ]; do
        [ -z "$chunk" ] && continue

        local text
        if [ "$first" = true ]; then
            text="*${header}*"$'\n'"$chunk"
            first=false
        else
            text="$chunk"
        fi

        local payload resp
        payload=$(jq -n --arg t "$text" '{ blocks: [
            { type: "section", text: { type: "mrkdwn", text: $t } }
        ]}')
        resp=$(curl -s -X POST -H 'Content-type: application/json' --data "$payload" "$SLACK_WEBHOOK")
        if [ "$resp" != "ok" ]; then
            echo -e "${YELLOW}  Warning: Slack section post returned: $resp${NC}"
            SLACK_ERRORS=$((SLACK_ERRORS+1))
        fi
    done <<< "$chunks"
}

SLACK_ERRORS=0

# --- Post 1: Release header ---
HEADER_PAYLOAD=$(jq -n --arg title "ClaudeFu $VERSION Released" '{
    blocks: [
        { type: "header", text: { type: "plain_text", text: $title, emoji: true } }
    ]
}')
RESP=$(curl -s -X POST -H 'Content-type: application/json' --data "$HEADER_PAYLOAD" "$SLACK_WEBHOOK")
[ "$RESP" != "ok" ] && echo -e "${YELLOW}  Warning: Slack header post returned: $RESP${NC}" && SLACK_ERRORS=$((SLACK_ERRORS+1))

# --- Post 2+: One message per ### section ---
# Split changelog by ### headers and post each as a separate message
CURRENT_SECTION=""
CURRENT_HEADER=""

while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ ^###\  ]]; then
        if [ -n "$CURRENT_HEADER" ] && [ -n "$CURRENT_SECTION" ]; then
            SLACK_TEXT=$(echo "$CURRENT_SECTION" | sed 's/\*\*\([^*]*\)\*\*/*\1*/g')
            post_section "$CURRENT_HEADER" "$SLACK_TEXT"
        fi
        # Start new section
        CURRENT_HEADER="${line#\#\#\# }"
        CURRENT_SECTION=""
    else
        # Accumulate lines into current section (skip leading blank lines)
        if [ -n "$CURRENT_HEADER" ]; then
            if [ -n "$CURRENT_SECTION" ] || [ -n "$line" ]; then
                CURRENT_SECTION="${CURRENT_SECTION}${line}
"
            fi
        fi
    fi
done <<< "$CHANGELOG_SECTION"

# Post the last buffered section
if [ -n "$CURRENT_HEADER" ] && [ -n "$CURRENT_SECTION" ]; then
    SLACK_TEXT=$(echo "$CURRENT_SECTION" | sed 's/\*\*\([^*]*\)\*\*/*\1*/g')
    post_section "$CURRENT_HEADER" "$SLACK_TEXT"
fi

# --- Final post: Install instructions ---
INSTALL_PAYLOAD=$(jq -n '{
    blocks: [
        { type: "divider" },
        { type: "section", text: { type: "mrkdwn", text: "*Install:* `brew tap metaphori-ai/claudefu && brew install --cask claudefu`" } }
    ]
}')
RESP=$(curl -s -X POST -H 'Content-type: application/json' --data "$INSTALL_PAYLOAD" "$SLACK_WEBHOOK")
[ "$RESP" != "ok" ] && echo -e "${YELLOW}  Warning: Slack footer post returned: $RESP${NC}" && SLACK_ERRORS=$((SLACK_ERRORS+1))

if [ "$SLACK_ERRORS" -eq 0 ]; then
    echo -e "${GREEN}Changelog posted to Slack!${NC}"
else
    echo -e "${YELLOW}Warning: $SLACK_ERRORS Slack post(s) had issues${NC}"
fi
