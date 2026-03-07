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
        # If we have a previous section buffered, post it
        if [ -n "$CURRENT_HEADER" ] && [ -n "$CURRENT_SECTION" ]; then
            # Convert markdown to Slack mrkdwn
            SLACK_TEXT=$(echo "$CURRENT_SECTION" | \
                sed 's/\*\*\([^*]*\)\*\*/*\1*/g')

            SECTION_PAYLOAD=$(jq -n \
                --arg header "*${CURRENT_HEADER}*" \
                --arg body "$SLACK_TEXT" \
                '{ blocks: [
                    { type: "section", text: { type: "mrkdwn", text: ($header + "\n" + $body) } }
                ]}')
            RESP=$(curl -s -X POST -H 'Content-type: application/json' --data "$SECTION_PAYLOAD" "$SLACK_WEBHOOK")
            [ "$RESP" != "ok" ] && echo -e "${YELLOW}  Warning: Slack section post returned: $RESP${NC}" && SLACK_ERRORS=$((SLACK_ERRORS+1))
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
    SLACK_TEXT=$(echo "$CURRENT_SECTION" | \
        sed 's/\*\*\([^*]*\)\*\*/*\1*/g')

    SECTION_PAYLOAD=$(jq -n \
        --arg header "*${CURRENT_HEADER}*" \
        --arg body "$SLACK_TEXT" \
        '{ blocks: [
            { type: "section", text: { type: "mrkdwn", text: ($header + "\n" + $body) } }
        ]}')
    RESP=$(curl -s -X POST -H 'Content-type: application/json' --data "$SECTION_PAYLOAD" "$SLACK_WEBHOOK")
    [ "$RESP" != "ok" ] && echo -e "${YELLOW}  Warning: Slack section post returned: $RESP${NC}" && SLACK_ERRORS=$((SLACK_ERRORS+1))
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
