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

echo -e "${YELLOW}=== ClaudeFu Release: $VERSION ===${NC}"

# Ensure we're on main and up to date
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
    echo -e "${RED}Error: Must be on main branch (currently on $BRANCH)${NC}"
    exit 1
fi

echo -e "${GREEN}[1/7] Building macOS universal binary...${NC}"
wails build -platform darwin/universal -o ClaudeFu

echo -e "${GREEN}[2/7] Creating ZIP archive...${NC}"
cd build/bin
ZIP_NAME="ClaudeFu-${VERSION}-darwin-universal.zip"
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" ClaudeFu.app
cd ../..

echo -e "${GREEN}[3/7] Calculating SHA256...${NC}"
SHA256=$(shasum -a 256 "build/bin/$ZIP_NAME" | awk '{print $1}')
echo "SHA256: $SHA256"

echo -e "${GREEN}[4/7] Creating git tag...${NC}"
git tag -a "$VERSION" -m "Release $VERSION"

echo -e "${GREEN}[5/7] Pushing tag to GitHub...${NC}"
git push origin "$VERSION"

echo -e "${GREEN}[6/7] Creating GitHub Release...${NC}"
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

echo -e "${GREEN}[7/7] Updating Homebrew tap...${NC}"
HOMEBREW_TAP_PATH="/Users/jasdeep/svml/homebrew-claudefu"

if [ -d "$HOMEBREW_TAP_PATH" ]; then
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

echo -e "${GREEN}=== Release $VERSION complete! ===${NC}"
echo ""
echo "Users can now install with:"
echo "  brew tap metaphori-ai/claudefu"
echo "  brew install --cask claudefu"
