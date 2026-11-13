#!/bin/bash
set -euo pipefail
NEATAB_SOURCE="$(cd "$(dirname "$0")" && pwd)"
NEATAB_USER_ROOT="${NEATAB_INSTALL_ROOT:-$HOME}"
NEATAB_HOME="$NEATAB_USER_ROOT/Library/Application Support/Neatab"
NEATAB_APP="$NEATAB_USER_ROOT/Applications/Neatab.app"
NEATAB_MANIFEST="$NEATAB_USER_ROOT/Library/Application Support/Google/Chrome/NativeMessagingHosts/app.neatab.helper.json"
if [[ ! -d "$NEATAB_SOURCE/Neatab.app" || ! -d "$NEATAB_SOURCE/neatab-extension" ]]; then
  echo "请从完整交付包中运行安装脚本。开发时先执行 npm run build 和 npm run package。"
  exit 1
fi
mkdir -p "$NEATAB_USER_ROOT/Applications" "$NEATAB_HOME" "$(dirname "$NEATAB_MANIFEST")"
# Install stable paths: a moved/deleted Downloads folder must not break the host.
/usr/bin/ditto "$NEATAB_SOURCE/Neatab.app" "$NEATAB_APP"
# The helper is ad-hoc signed, not notarized. A downloaded copy carries the quarantine flag, which would
# stop Chrome from launching it; running this installer is the user's consent to trust this one app.
/usr/bin/xattr -dr com.apple.quarantine "$NEATAB_APP" 2>/dev/null || true
/usr/bin/ditto "$NEATAB_SOURCE/neatab-extension" "$NEATAB_HOME/neatab-extension"
# The unpacked build and the Chrome Web Store build have different IDs; allow both.
NEATAB_IDS=()
for NEATAB_ID_FILE in "$NEATAB_SOURCE/extension-id.txt" "$NEATAB_SOURCE/store-extension-id.txt"; do
  [[ -f "$NEATAB_ID_FILE" ]] || continue
  NEATAB_ID="$(tr -d '\n\r' < "$NEATAB_ID_FILE")"
  if [[ ! "$NEATAB_ID" =~ ^[a-p]{32}$ ]]; then echo "扩展 ID 无效：$NEATAB_ID_FILE"; exit 1; fi
  NEATAB_IDS+=("$NEATAB_ID")
done
if [[ ${#NEATAB_IDS[@]} -eq 0 ]]; then echo "缺少扩展 ID"; exit 1; fi
# Use the system's JSON serializer, never interpolate a user path into JSON.
/usr/bin/plutil -create xml1 "$NEATAB_MANIFEST.plist"
/usr/bin/plutil -insert name -string app.neatab.helper "$NEATAB_MANIFEST.plist"
/usr/bin/plutil -insert description -string "Neatab local tab switcher" "$NEATAB_MANIFEST.plist"
/usr/bin/plutil -insert type -string stdio "$NEATAB_MANIFEST.plist"
/usr/bin/plutil -insert path -string "$NEATAB_APP/Contents/MacOS/Neatab" "$NEATAB_MANIFEST.plist"
/usr/bin/plutil -insert allowed_origins -array "$NEATAB_MANIFEST.plist"
for NEATAB_INDEX in "${!NEATAB_IDS[@]}"; do
  /usr/bin/plutil -insert "allowed_origins.$NEATAB_INDEX" -string "chrome-extension://${NEATAB_IDS[$NEATAB_INDEX]}/" "$NEATAB_MANIFEST.plist"
done
/usr/bin/plutil -convert json -o "$NEATAB_MANIFEST" "$NEATAB_MANIFEST.plist"
rm "$NEATAB_MANIFEST.plist"
echo ""
echo "Neatab 辅助程序已安装。"
echo "已从 Chrome 网上应用店安装 Neatab：直接点击扩展图标 → 开启辅助功能权限即可，跳过下面第 1、2 步。"
echo "使用开发版：接下来在 Chrome："
echo "1. 打开 chrome://extensions，开启开发者模式。"
echo "2. 点击『加载已解压的扩展程序』，选择："
echo "   $NEATAB_HOME/neatab-extension"
echo "3. 点击 Neatab 扩展图标 → 开启辅助功能权限，在系统设置中允许 Neatab。"
echo "   更新旧版后，请重新加载 Chrome 中的 Neatab；若权限仍失效，请从辅助功能列表移除旧 Neatab，"
echo "   再用 + 添加 $NEATAB_APP 并开启，以更新系统保存的程序身份。"
echo ""
echo "之后即可按住 Option + 连按 Tab，松开切换最近 7 个标签页。"
echo "Command + Shift + C 复制当前网页链接。"
echo "按任意键退出。"
if [[ -t 0 ]]; then read -r -n 1; fi
