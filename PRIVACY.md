# Neatab 隐私政策 / Privacy Policy

生效日期：2026 年 10 月 29 日

## 中文

Neatab 是一个 Chrome 扩展，配合可选的 macOS 辅助程序使用。Neatab 不收集、不上传、不出售任何用户数据，没有服务器、账号、分析或广告。

**Neatab 在你的设备上读取和处理的信息**

| 信息 | 用途 | 存放位置 |
| --- | --- | --- |
| 标签页的标题、网址、所在窗口、访问时间，标签页分组的名称和颜色 | 显示最近标签页、切换标签页、找出重复页和不活跃标签页，在列表中显示分组 | 扩展的内存与 Chrome 会话存储，关闭浏览器后清除 |
| 当前可见标签页的截图（可在设置中关闭） | 在 Option + Tab 切换器里显示网页预览 | 扩展内存与 Chrome 本地存储，最多 10 组，7 天后或关闭预览时删除；无痕窗口从不截图 |
| 离开电脑的时段（锁屏、无操作、休眠、Chrome 退出的开始和结束时间） | 计算不活跃时长时扣掉不在电脑前的时间 | Chrome 本地存储，保留 60 天 |
| 设置（切换范围、是否显示预览） | 记住你的选择 | Chrome 本地存储 |
| 当前网页的网址（按 ⌘ ⇧ C 时） | 写入系统剪贴板 | 系统剪贴板；Neatab 不读取剪贴板原有内容 |

**离开提示检查**：自动释放内存前，Neatab 在该页面里临时模拟一次离开，只判断关闭时是否会弹出「离开网站？」，返回「是/否」，不读取、不保存、不上传页面内容。

上述信息只在你的电脑上处理。扩展通过 Chrome Native Messaging 与本机的 Neatab 辅助程序交换最近标签页的标题、网址和预览，用于绘制切换器；辅助程序不联网、不写入文件。

**macOS 辅助功能权限**：辅助程序用它接收 Option + Tab 和 ⌘ ⇧ C 这几个按键，只在 Chrome 普通窗口在前台时响应，不记录你输入的文字。

**无痕窗口**：Neatab 不在无痕窗口中运行，也不读取无痕窗口的标签页。

**第三方**：Neatab 不与任何第三方共享数据。

**变更**：本政策如有变更，会更新本页并修改生效日期。

**联系**：请在 [GitHub Issues](https://github.com/iAlexKai/neatab/issues) 提问。

## English

Neatab is a Chrome extension with an optional macOS helper app. Neatab does not collect, transmit or sell any user data. It has no servers, accounts, analytics or ads.

Neatab reads tab titles, URLs, windows and access times to show recent tabs, switch tabs, and find duplicate and inactive tabs. When previews are on, it captures the visible tab and keeps the images in memory and in the extension's local storage on this device (at most 10, deleted after 7 days or when previews are turned off; incognito tabs are never captured). Settings are kept in Chrome local storage. When you press ⌘ ⇧ C, the current page URL is written to the system clipboard; existing clipboard contents are never read.

All of this stays on your computer. The extension exchanges recent tab titles, URLs and previews with the local Neatab helper over Chrome Native Messaging to draw the switcher. The helper makes no network connections. Its macOS Accessibility permission is used only to receive Option + Tab and ⌘ ⇧ C while a normal Chrome window is in front, and typed text is never recorded. Neatab does not run in incognito windows and shares nothing with third parties.

Questions: [GitHub Issues](https://github.com/iAlexKai/neatab/issues).
