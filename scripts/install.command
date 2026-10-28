#!/bin/bash
set -euo pipefail
SEVEN_SOURCE="$(cd "$(dirname "$0")" && pwd)"
SEVEN_USER_ROOT="${SEVEN_INSTALL_ROOT:-$HOME}"
SEVEN_HOME="$SEVEN_USER_ROOT/Library/Application Support/Seven"
SEVEN_APP="$SEVEN_USER_ROOT/Applications/Seven.app"
SEVEN_MANIFEST="$SEVEN_USER_ROOT/Library/Application Support/Google/Chrome/NativeMessagingHosts/app.seven.switcher.json"
if [[ ! -d "$SEVEN_SOURCE/Seven.app" || ! -d "$SEVEN_SOURCE/seven-extension" ]]; then
  echo "请从完整交付包中运行安装脚本。开发时先执行 npm run build 和 npm run package。"
  exit 1
fi
mkdir -p "$SEVEN_USER_ROOT/Applications" "$SEVEN_HOME" "$(dirname "$SEVEN_MANIFEST")"
# Install stable paths: a moved/deleted Downloads folder must not break the host.
/usr/bin/ditto "$SEVEN_SOURCE/Seven.app" "$SEVEN_APP"
/usr/bin/ditto "$SEVEN_SOURCE/seven-extension" "$SEVEN_HOME/seven-extension"
SEVEN_ID="$(tr -d '\n\r' < "$SEVEN_SOURCE/extension-id.txt")"
if [[ ! "$SEVEN_ID" =~ ^[a-p]{32}$ ]]; then echo "扩展 ID 无效"; exit 1; fi
# Use the system's JSON serializer, never interpolate a user path into JSON.
/usr/bin/plutil -create xml1 "$SEVEN_MANIFEST.plist"
/usr/bin/plutil -insert name -string app.seven.switcher "$SEVEN_MANIFEST.plist"
/usr/bin/plutil -insert description -string "Seven local tab switcher" "$SEVEN_MANIFEST.plist"
/usr/bin/plutil -insert type -string stdio "$SEVEN_MANIFEST.plist"
/usr/bin/plutil -insert path -string "$SEVEN_APP/Contents/MacOS/Seven" "$SEVEN_MANIFEST.plist"
/usr/bin/plutil -insert allowed_origins -array "$SEVEN_MANIFEST.plist"
/usr/bin/plutil -insert allowed_origins.0 -string "chrome-extension://$SEVEN_ID/" "$SEVEN_MANIFEST.plist"
/usr/bin/plutil -convert json -o "$SEVEN_MANIFEST" "$SEVEN_MANIFEST.plist"
rm "$SEVEN_MANIFEST.plist"
echo ""
echo "Seven 辅助程序已安装。接下来在 Chrome："
echo "1. 打开 chrome://extensions，开启开发者模式。"
echo "2. 点击『加载已解压的扩展程序』，选择："
echo "   $SEVEN_HOME/seven-extension"
echo "3. 点击 Seven 扩展图标 → 开启辅助功能权限，在系统设置中允许 Seven。"
echo "   更新旧版后，请重新加载 Chrome 中的 Seven；若权限仍失效，请从辅助功能列表移除旧 Seven，"
echo "   再用 + 添加 $SEVEN_APP 并开启，以更新系统保存的程序身份。"
echo ""
echo "之后即可按住 Option + 连按 Tab，松开切换最近 7 个标签页。"
echo "Command + Shift + C 复制当前网页链接。"
echo "按任意键退出。"
if [[ -t 0 ]]; then read -r -n 1; fi
