#!/bin/bash

# Tab Switcher Native Host Uninstaller

set -e

HOST_NAME="build.robin.tabswitcher.native"
INSTALL_DIR="$HOME/.tab-switcher-robin"
CHROME_NATIVE_HOSTS_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

echo "========================================"
echo "Tab Switcher Native Host Uninstaller"
echo "========================================"
echo ""

# Remove the new binary directory
if [[ -d "$INSTALL_DIR" ]]; then
    echo "Removing binary directory: $INSTALL_DIR"
    rm -rf "$INSTALL_DIR"
else
    echo "Binary directory not found (already removed?)"
fi

# Remove the manifest
MANIFEST_PATH="$CHROME_NATIVE_HOSTS_DIR/$HOST_NAME.json"
if [[ -f "$MANIFEST_PATH" ]]; then
    echo "Removing manifest: $MANIFEST_PATH"
    rm "$MANIFEST_PATH"
else
    echo "Manifest not found (already removed?)"
fi

echo ""
echo "Uninstallation complete!"
echo ""
echo "Note: You may also want to remove Accessibility permissions:"
echo "  System Settings > Privacy & Security > Accessibility"
echo "  Remove: tab-switcher (or Tab Switcher.app)"
echo ""
