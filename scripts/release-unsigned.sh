#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ==============================================================================
# UNSIGNED RELEASE SCRIPT
# ==============================================================================
# Use this when:
# - Apple notarization is slow/stuck
# - You want a quick release for testing
# - Users can handle the Gatekeeper bypass
#
# For signed releases once notarization is working: use release.sh
# ==============================================================================

# Check if version argument provided
if [ -z "$1" ]; then
    echo -e "${RED}Usage: ./scripts/release-unsigned.sh v0.3.17${NC}"
    echo "Current tags:"
    git tag --sort=-v:refname | head -5
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

echo -e "${YELLOW}=== ClaudeFu UNSIGNED Release: $VERSION ===${NC}"
echo -e "${YELLOW}Note: This build will NOT be signed or notarized${NC}"
echo ""

# Ensure we're on main and up to date
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
    echo -e "${RED}Error: Must be on main branch (currently on $BRANCH)${NC}"
    exit 1
fi

# ==============================================================================
# BUILD
# ==============================================================================
echo -e "${GREEN}[1/6] Building macOS universal binary...${NC}"

# Clean any existing .app bundles to avoid case-sensitivity issues
rm -rf build/bin/*.app

wails build -platform darwin/universal -o ClaudeFu

# ==============================================================================
# CREATE ZIP FOR DISTRIBUTION
# ==============================================================================
echo -e "${GREEN}[2/6] Creating ZIP archive...${NC}"
cd build/bin
ZIP_NAME="ClaudeFu-${VERSION}-darwin-universal.zip"
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" ClaudeFu.app
cd ../..

echo -e "${GREEN}[3/6] Calculating SHA256...${NC}"
SHA256=$(shasum -a 256 "build/bin/$ZIP_NAME" | awk '{print $1}')
echo "SHA256: $SHA256"

echo -e "${GREEN}[4/6] Creating git tag...${NC}"
git tag -a "$VERSION" -m "Release $VERSION"

echo -e "${GREEN}[5/6] Pushing tag to GitHub...${NC}"
git push origin "$VERSION"

echo -e "${GREEN}[6/6] Creating GitHub Release...${NC}"

gh release create "$VERSION" \
    "build/bin/$ZIP_NAME" \
    --title "ClaudeFu $VERSION" \
    --notes "## Installation

**Via Homebrew (recommended):**
\`\`\`bash
brew tap metaphori-ai/claudefu
brew install --cask claudefu
\`\`\`

**Manual download:**
1. Download \`$ZIP_NAME\`
2. Unzip and move \`ClaudeFu.app\` to \`/Applications\`
3. If blocked by Gatekeeper: \`xattr -cr /Applications/ClaudeFu.app\`

**Requirements:**
- macOS 11.0 (Big Sur) or later
- Claude Code CLI: \`npm install -g @anthropic-ai/claude-code\`"

# ==============================================================================
# HOMEBREW TAP UPDATE
# ==============================================================================
echo -e "${GREEN}Updating Homebrew tap...${NC}"

# Check if HOMEBREW_TAP_PATH is configured
if [ -z "$HOMEBREW_TAP_PATH" ]; then
    echo -e "${YELLOW}Skipping Homebrew tap update (HOMEBREW_TAP_PATH not set in .env)${NC}"
    echo "Manually update with:"
    echo "  version \"$VERSION_NUM\""
    echo "  sha256 \"$SHA256\""
elif [ -d "$HOMEBREW_TAP_PATH" ]; then
    cd "$HOMEBREW_TAP_PATH"

    # Update the cask file
    sed -i '' "s/version \".*\"/version \"$VERSION_NUM\"/" Casks/claudefu.rb
    sed -i '' "s/sha256 \".*\"/sha256 \"$SHA256\"/" Casks/claudefu.rb

    # Commit and push
    git add Casks/claudefu.rb
    git commit -m "Update ClaudeFu to $VERSION"
    git push

    echo -e "${GREEN}Homebrew tap updated!${NC}"
else
    echo -e "${YELLOW}Warning: Homebrew tap not found at $HOMEBREW_TAP_PATH${NC}"
    echo "Manually update with:"
    echo "  version \"$VERSION_NUM\""
    echo "  sha256 \"$SHA256\""
fi

# ==============================================================================
# SLACK NOTIFICATION
# ==============================================================================
# Check if SLACK_WEBHOOK is configured
if [ -z "$SLACK_WEBHOOK" ]; then
    echo -e "${YELLOW}Skipping Slack post (SLACK_WEBHOOK not set in .env)${NC}"
else
    # Extract changelog for this version (between ## [version] and next ## [)
    CHANGELOG_SECTION=$(awk "/^## \[$VERSION_NUM\]/{flag=1; next} /^## \[/{flag=0} flag" "$REPO_ROOT/CHANGELOG.md")

    if [ -n "$CHANGELOG_SECTION" ]; then
        # Convert markdown to Slack mrkdwn:
        # - **bold** → *bold*
        # - ### Header → *Header*
        SLACK_TEXT=$(echo "$CHANGELOG_SECTION" | \
            sed 's/\*\*\([^*]*\)\*\*/*\1*/g' | \
            sed 's/^### \(.*\)/*\1*/g' | \
            sed 's/^## \(.*\)/*\1*/g')

        # Build Slack payload
        SLACK_PAYLOAD=$(cat <<EOFSLACK
{
    "blocks": [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "ClaudeFu $VERSION Released",
                "emoji": true
            }
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": $(echo "$SLACK_TEXT" | jq -Rs .)
            }
        },
        {
            "type": "divider"
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "*Install:* \`brew tap metaphori-ai/claudefu && brew install --cask claudefu\`"
            }
        }
    ]
}
EOFSLACK
)

        # Post to Slack
        SLACK_RESPONSE=$(curl -s -X POST -H 'Content-type: application/json' --data "$SLACK_PAYLOAD" "$SLACK_WEBHOOK")
        if [ "$SLACK_RESPONSE" = "ok" ]; then
            echo -e "${GREEN}Changelog posted to Slack!${NC}"
        else
            echo -e "${YELLOW}Warning: Slack post returned: $SLACK_RESPONSE${NC}"
        fi
    else
        echo -e "${YELLOW}Warning: Could not extract changelog for version $VERSION_NUM${NC}"
    fi
fi

echo ""
echo -e "${GREEN}=== UNSIGNED Release $VERSION complete! ===${NC}"
echo ""
echo "Users can now install with:"
echo "  brew tap metaphori-ai/claudefu"
echo "  brew install --cask claudefu"
echo ""
echo -e "${YELLOW}Note: Users may need to run: xattr -cr /Applications/ClaudeFu.app${NC}"
echo ""
echo "Once Apple notarization catches up, future releases can use:"
echo "  ./scripts/release.sh vX.Y.Z"
