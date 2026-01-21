#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if version argument provided
if [ -z "$1" ]; then
    echo -e "${RED}Usage: ./scripts/release.sh v0.2.7${NC}"
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

echo -e "${YELLOW}=== ClaudeFu Release: $VERSION ===${NC}"

# Ensure we're on main and up to date
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
    echo -e "${RED}Error: Must be on main branch (currently on $BRANCH)${NC}"
    exit 1
fi

# ==============================================================================
# CODE SIGNING CONFIGURATION
# ==============================================================================
# Check for Developer ID certificate
DEVELOPER_ID="Developer ID Application: Metaphori, Inc."
SIGN_ENABLED=false

if security find-identity -v -p codesigning 2>/dev/null | grep -q "$DEVELOPER_ID"; then
    SIGN_ENABLED=true
    echo -e "${GREEN}✓ Found Developer ID certificate: $DEVELOPER_ID${NC}"
else
    echo -e "${YELLOW}⚠ No Developer ID certificate found - builds will be unsigned${NC}"
    echo "  To enable signing, install your Apple Developer certificate"
fi

# Check for notarization credentials (Apple ID in keychain)
NOTARIZE_ENABLED=false
KEYCHAIN_PROFILE="ClaudeFu-Notarize"  # Set up with: xcrun notarytool store-credentials

if [ "$SIGN_ENABLED" = true ] && xcrun notarytool history --keychain-profile "$KEYCHAIN_PROFILE" &>/dev/null; then
    NOTARIZE_ENABLED=true
    echo -e "${GREEN}✓ Found notarization credentials: $KEYCHAIN_PROFILE${NC}"
else
    if [ "$SIGN_ENABLED" = true ]; then
        echo -e "${YELLOW}⚠ No notarization credentials found - builds will not be notarized${NC}"
        echo "  To enable notarization, run:"
        echo "    xcrun notarytool store-credentials $KEYCHAIN_PROFILE \\"
        echo "      --apple-id your@email.com \\"
        echo "      --team-id XXXXXXXXXX \\"
        echo "      --password <app-specific-password>"
    fi
fi

echo ""

# ==============================================================================
# BUILD
# ==============================================================================
echo -e "${GREEN}[1/10] Building macOS universal binary...${NC}"

# Clean any existing .app bundles to avoid case-sensitivity issues
# (macOS can't rename claudefu.app -> ClaudeFu.app on case-insensitive FS)
rm -rf build/bin/*.app

wails build -platform darwin/universal -o ClaudeFu

# ==============================================================================
# CODE SIGNING (if certificate available)
# ==============================================================================
if [ "$SIGN_ENABLED" = true ]; then
    echo -e "${GREEN}[2/10] Signing application with Developer ID...${NC}"

    APP_PATH="build/bin/ClaudeFu.app"
    ENTITLEMENTS="build/darwin/entitlements.plist"

    # Sign the app bundle (--deep handles all nested components)
    echo "  Signing app bundle..."
    codesign --force --deep --options runtime --timestamp \
        --entitlements "$ENTITLEMENTS" \
        --sign "$DEVELOPER_ID" "$APP_PATH"

    # Verify signature
    echo "  Verifying signature..."
    if codesign --verify --deep --strict "$APP_PATH" 2>&1; then
        echo -e "${GREEN}  ✓ Code signing complete${NC}"
    else
        echo -e "${YELLOW}  ⚠ Signature verification warning (may still notarize)${NC}"
    fi
else
    echo -e "${YELLOW}[2/10] Skipping code signing (no certificate)${NC}"
fi

# ==============================================================================
# CREATE ZIP FOR NOTARIZATION/DISTRIBUTION
# ==============================================================================
echo -e "${GREEN}[3/10] Creating ZIP archive...${NC}"
cd build/bin
ZIP_NAME="ClaudeFu-${VERSION}-darwin-universal.zip"
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" ClaudeFu.app
cd ../..

# ==============================================================================
# NOTARIZATION (if credentials available)
# ==============================================================================
if [ "$NOTARIZE_ENABLED" = true ]; then
    echo -e "${GREEN}[4/10] Submitting for notarization...${NC}"
    echo "  This may take several minutes..."

    NOTARIZE_OUTPUT=$(xcrun notarytool submit "build/bin/$ZIP_NAME" \
        --keychain-profile "$KEYCHAIN_PROFILE" \
        --wait 2>&1)

    if echo "$NOTARIZE_OUTPUT" | grep -q "status: Accepted"; then
        echo -e "${GREEN}  ✓ Notarization accepted${NC}"

        # Staple the ticket to the app
        echo -e "${GREEN}[5/10] Stapling notarization ticket...${NC}"
        xcrun stapler staple "build/bin/ClaudeFu.app"
        echo -e "${GREEN}  ✓ Ticket stapled${NC}"

        # Re-create ZIP with stapled app
        echo "  Re-creating ZIP with stapled app..."
        cd build/bin
        rm -f "$ZIP_NAME"
        zip -r "$ZIP_NAME" ClaudeFu.app
        cd ../..
    else
        echo -e "${YELLOW}  ⚠ Notarization issue - check output:${NC}"
        echo "$NOTARIZE_OUTPUT"
        echo ""
        echo -e "${YELLOW}  Continuing with unsigned release...${NC}"
    fi
else
    if [ "$SIGN_ENABLED" = true ]; then
        echo -e "${YELLOW}[4/10] Skipping notarization (no credentials)${NC}"
        echo -e "${YELLOW}[5/10] Skipping stapling (no notarization)${NC}"
    else
        echo -e "${YELLOW}[4/10] Skipping notarization (unsigned build)${NC}"
        echo -e "${YELLOW}[5/10] Skipping stapling (unsigned build)${NC}"
    fi
fi

echo -e "${GREEN}[6/10] Calculating SHA256...${NC}"
SHA256=$(shasum -a 256 "build/bin/$ZIP_NAME" | awk '{print $1}')
echo "SHA256: $SHA256"

echo -e "${GREEN}[7/10] Creating git tag...${NC}"
git tag -a "$VERSION" -m "Release $VERSION"

echo -e "${GREEN}[8/10] Pushing tag to GitHub...${NC}"
git push origin "$VERSION"

echo -e "${GREEN}[9/10] Creating GitHub Release...${NC}"
# Build release notes based on signing status
if [ "$NOTARIZE_ENABLED" = true ]; then
    GATEKEEPER_NOTE="This build is signed and notarized by Apple."
else
    GATEKEEPER_NOTE="If blocked by Gatekeeper: \`xattr -cr /Applications/ClaudeFu.app\`"
fi

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
3. $GATEKEEPER_NOTE

**Requirements:**
- macOS 11.0 (Big Sur) or later
- Claude Code CLI: \`npm install -g @anthropic-ai/claude-code\`"

echo -e "${GREEN}[10/10] Updating Homebrew tap & Slack...${NC}"

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

# Post changelog to Slack

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

echo -e "${GREEN}=== Release $VERSION complete! ===${NC}"
echo ""
echo "Users can now install with:"
echo "  brew tap metaphori-ai/claudefu"
echo "  brew install --cask claudefu"
