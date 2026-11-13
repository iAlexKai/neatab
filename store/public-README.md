# Neatab

在 Chrome 中获得 Arc 最核心的标签体验。Bring the core of Arc's tab experience to Chrome.

- **Option + Tab**：在最近使用的 7 个标签页之间切换，按住 Option 选择，松开切换。
- **关闭重复页**：每个地址只保留最近活跃的那个。
- **清理不活跃标签页**：按 48 小时以上、24–48 小时、12–24 小时、12 小时以内分组，可全部关闭或按组关闭，8 秒内可撤销。
- **⌘ ⇧ C**：复制当前网页的完整链接。

Neatab 与 Arc 及 The Browser Company 没有关联。Neatab is not affiliated with Arc or The Browser Company.

## Install

1. 从 Chrome 网上应用店安装 Neatab。标签整理功能装好即可使用。
2. Option + Tab 和 ⌘ ⇧ C 需要免费的 macOS 辅助程序（macOS 13+，Apple 芯片和 Intel 均可）：从 [Releases](https://github.com/iAlexKai/neatab/releases/latest) 下载 `Neatab-macOS.zip` 并解压。
3. 双击 **安装 Neatab.command**。辅助程序未经过 Apple 公证，macOS 第一次会拦截：打开 **系统设置 → 隐私与安全性**，在页面下方点 **仍要打开**。安装脚本会去掉所安装的 `Neatab.app` 上的下载隔离标记，否则 Chrome 无法启动它。
4. 回到 Chrome，点击 Neatab 图标 → **重新连接** → **开启辅助功能权限**，在 **系统设置 → 隐私与安全性 → 辅助功能** 中允许 **Neatab**。显示「已就绪」后即可使用。

The helper installs to `~/Applications/Neatab.app` and registers a Chrome Native Messaging host that only the Neatab extension can use. To uninstall, remove the extension in Chrome and run **卸载 Neatab.command** from the same download.

## Privacy

Neatab 不收集、不上传任何数据，所有处理都在你的电脑上完成。详见 [隐私政策 / Privacy Policy](../PRIVACY.md)。

## Feedback

问题与建议请提 [Issue](https://github.com/iAlexKai/neatab/issues)。
