#!/bin/bash
# Builds PagePilot.app and a drag-to-Applications DMG installer.
# Uses only tools that ship with macOS (sips, iconutil, hdiutil).
#
#   ./tools/build-macos-app.sh
#
# Output: dist/PagePilot.app and dist/PagePilot-Installer.dmg

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
APP="$DIST/PagePilot.app"
VOLNAME="PagePilot Installer"

echo "==> Cleaning dist/"
rm -rf "$DIST"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app"

# --- 1. App icon (.icns) from the PWA icon ------------------------------
echo "==> Building icon.icns"
ICONSET="$DIST/PagePilot.iconset"
mkdir -p "$ICONSET"
SRC="$ROOT/icons/icon-512.png"
for size in 16 32 64 128 256 512; do
  sips -z $size $size "$SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  if [ $size -ne 16 ]; then
    half=$((size / 2))
    cp "$ICONSET/icon_${size}x${size}.png" "$ICONSET/icon_${half}x${half}@2x.png"
  fi
done
cp "$SRC" "$ICONSET/icon_512x512@2x.png" 2>/dev/null || true
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/icon.icns"
rm -rf "$ICONSET"

# --- 2. Copy the web app into the bundle --------------------------------
echo "==> Copying app files"
cp "$ROOT/index.html" "$ROOT/manifest.webmanifest" "$ROOT/sw.js" "$APP/Contents/Resources/app/"
cp -R "$ROOT/css" "$ROOT/js" "$ROOT/icons" "$APP/Contents/Resources/app/"

# --- 3. Launcher ----------------------------------------------------------
echo "==> Writing launcher"
cat > "$APP/Contents/MacOS/PagePilot" <<'LAUNCHER'
#!/bin/bash
# PagePilot launcher: serves the bundled app on localhost and opens it in
# app mode (Chrome/Edge/Brave) or the default browser.
set -u
APP_DIR="$(cd "$(dirname "$0")/../Resources/app" && pwd)"
BASE_PORT=8417

port=$BASE_PORT
for try in 0 1 2 3 4; do
  port=$((BASE_PORT + try))
  # Already ours? Reuse it.
  if curl -s --max-time 1 "http://127.0.0.1:$port/manifest.webmanifest" 2>/dev/null | grep -q PagePilot; then
    break
  fi
  # Free? Claim it.
  if ! lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then
    nohup /usr/bin/python3 -m http.server "$port" --bind 127.0.0.1 --directory "$APP_DIR" \
      >/dev/null 2>&1 &
    for i in $(seq 1 20); do
      curl -s --max-time 1 "http://127.0.0.1:$port/" >/dev/null 2>&1 && break
      sleep 0.15
    done
    break
  fi
done

URL="http://127.0.0.1:$port/"
for browser in "Google Chrome" "Microsoft Edge" "Brave Browser" "Chromium"; do
  if [ -d "/Applications/$browser.app" ]; then
    open -na "$browser" --args --app="$URL"
    exit 0
  fi
done
open "$URL"
LAUNCHER
chmod +x "$APP/Contents/MacOS/PagePilot"

# --- 4. Info.plist --------------------------------------------------------
echo "==> Writing Info.plist"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>              <string>PagePilot</string>
  <key>CFBundleDisplayName</key>       <string>PagePilot</string>
  <key>CFBundleIdentifier</key>        <string>dev.pagepilot.app</string>
  <key>CFBundleVersion</key>           <string>1.0.0</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundlePackageType</key>       <string>APPL</string>
  <key>CFBundleExecutable</key>        <string>PagePilot</string>
  <key>CFBundleIconFile</key>          <string>icon</string>
  <key>LSMinimumSystemVersion</key>    <string>11.0</string>
  <key>LSUIElement</key>               <true/>
  <key>NSHighResolutionCapable</key>   <true/>
</dict>
</plist>
PLIST

# --- 5. DMG with drag-to-Applications ------------------------------------
echo "==> Building DMG"
STAGING="$DIST/dmg-staging"
mkdir -p "$STAGING"
cp -R "$APP" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
cat > "$STAGING/READ ME FIRST.txt" <<'NOTE'
PagePilot — GitHub Pages Deployer

Install: drag PagePilot.app onto the Applications folder alias next to it.

First launch: right-click (Control-click) PagePilot.app and choose "Open"
(the app is not code-signed, so macOS asks once).

PagePilot opens in your browser as an app window and runs entirely on your
Mac — nothing is sent anywhere except api.github.com.
NOTE
hdiutil create -volname "$VOLNAME" -srcfolder "$STAGING" -ov -format UDZO \
  "$DIST/PagePilot-Installer.dmg" >/dev/null
rm -rf "$STAGING"

echo "==> Done"
echo "    $APP"
echo "    $DIST/PagePilot-Installer.dmg"
