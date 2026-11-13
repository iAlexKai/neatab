#!/bin/bash
set -euo pipefail
echo "此操作只移除 Neatab 辅助程序及其扩展文件。Chrome 中的扩展请先手动移除。"
echo "输入 REMOVE 确认："
read -r NEATAB_CONFIRM
if [[ "$NEATAB_CONFIRM" != "REMOVE" ]]; then exit 0; fi
rm -f "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/app.neatab.helper.json"
rm -rf "$HOME/Applications/Neatab.app" "$HOME/Library/Application Support/Neatab"
echo "Neatab 已卸载。可在系统设置中移除 Neatab 的辅助功能权限。"
