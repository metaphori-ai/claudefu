#!/bin/bash
# ==============================================================================
# ClaudeFu Notarization Setup (One-Time)
# ==============================================================================
#
# This script guides you through setting up Apple notarization credentials.
# Run this ONCE after installing your Apple Developer certificate.
#
# Prerequisites:
# 1. Apple Developer Program membership (paid)
# 2. Developer ID Application certificate installed in Keychain
# 3. App-specific password from appleid.apple.com
#
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}=== ClaudeFu Notarization Setup ===${NC}"
echo ""

# Check for Developer ID certificate
echo -e "${YELLOW}Step 1: Checking for Developer ID certificate...${NC}"
if security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application"; then
    echo -e "${GREEN}✓ Found Developer ID certificate${NC}"
    security find-identity -v -p codesigning | grep "Developer ID Application"
else
    echo -e "${RED}✗ No Developer ID certificate found${NC}"
    echo ""
    echo "To install your certificate:"
    echo "  1. Go to developer.apple.com → Certificates"
    echo "  2. Create a 'Developer ID Application' certificate"
    echo "  3. Download and double-click to install in Keychain"
    echo ""
    exit 1
fi

echo ""
echo -e "${YELLOW}Step 2: Setting up notarization credentials...${NC}"
echo ""
echo "You'll need:"
echo "  • Your Apple ID email"
echo "  • Your Team ID (from developer.apple.com → Membership)"
echo "  • An app-specific password (from appleid.apple.com → Security)"
echo ""
echo -e "${CYAN}Run this command with your actual values:${NC}"
echo ""
echo "  xcrun notarytool store-credentials ClaudeFu-Notarize \\"
echo "    --apple-id YOUR_APPLE_ID@example.com \\"
echo "    --team-id XXXXXXXXXX \\"
echo "    --password YOUR_APP_SPECIFIC_PASSWORD"
echo ""
echo -e "${YELLOW}Note: This stores credentials in your macOS Keychain (secure, local only)${NC}"
echo ""

# Offer to run interactively
read -p "Would you like to run this interactively now? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${CYAN}Running notarytool store-credentials interactively...${NC}"
    echo "(You'll be prompted for each value)"
    echo ""
    xcrun notarytool store-credentials ClaudeFu-Notarize

    echo ""
    echo -e "${GREEN}✓ Credentials stored successfully!${NC}"
    echo ""
    echo "You can now run ./scripts/release.sh and it will automatically"
    echo "sign and notarize your builds."
else
    echo ""
    echo "No problem! Run the command above when you're ready."
fi
