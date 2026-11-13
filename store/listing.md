# Chrome Web Store listing · Neatab 2.0.0

Fill these into the developer dashboard. Upload: `dist/Neatab-2.1.0-chrome-web-store.zip` (run `npm run build && npm run package`). Images: `dist/store-assets/` (run `node scripts/store-assets.mjs`).

## Store listing

- **Name** (from manifest): Neatab · 最近标签切换与整理
- **Summary** (from manifest, ≤ 132): 在 Chrome 中获得 Arc 最核心的标签体验：Option+Tab 切换最近标签页，一键关闭重复页和不活跃标签页。
- **Category**: Productivity → Workflow & Planning
- **Language**: 中文（简体）
- **Store icon**: `extension/icon128.png`
- **Screenshots** (1280×800): `1-switcher.png`, `2-duplicates.png`, `3-inactive.png`, `4-popup.png`
- **Small promo tile** (440×280): `promo-tile-440x280.png`
- **Homepage URL**: https://github.com/iAlexKai/neatab
- **Support URL**: https://github.com/iAlexKai/neatab/issues

### Description

```
在 Chrome 中获得 Arc 最核心的标签体验：快速回到刚才的标签页，让打开的标签页自己保持整洁。

⌥ Option + Tab：回到刚才的上下文
按住 Option 连按 Tab，在最近使用的 7 个标签页之间选择，松开即切换。顺序按你实际访问的先后排列，与标签栏位置无关；跨窗口也能切，连按两次可在最后两个页面间来回。

关闭重复页
同一个地址打开了好几次？「所有标签页」按窗口列出所有标签页并标出重复项，一键关闭重复页，每个地址只保留最近活跃的那个。固定、正在显示或正在播放声音的标签页不受影响。

清理不活跃标签页
按多久没有切换到，把标签页分成 48 小时以上、24–48 小时、12–24 小时和 12 小时以内四组。可以一键关闭所有超过 12 小时的标签页，也可以按组关闭；关闭后 8 秒内可撤销。

⌘ ⇧ C：复制当前网页链接
保留查询参数和 # 锚点，复制成功后有一个不抢焦点的轻提示。

需要 macOS 辅助程序的功能
Option + Tab 和 ⌘ ⇧ C 需要在任何网页、地址栏和 Chrome 内部页面上接管按键，这超出了 Chrome 扩展本身的能力，因此需要安装免费的 Neatab macOS 辅助程序（macOS 13+）。下载与安装说明：https://github.com/iAlexKai/neatab
标签整理功能无需辅助程序，安装扩展即可使用。

隐私
所有处理都在你的电脑上完成。没有服务器、账号、分析或广告，不收集、不上传任何数据。

Neatab 与 Arc 及 The Browser Company 没有关联。
```

## Privacy practices

### Single purpose

```
Neatab helps users move between and tidy their open Chrome tabs: switch to recently used tabs with Option+Tab, close duplicate tabs, and close tabs that have been inactive for a chosen time.
```

### Permission justifications

**tabs**
```
Reads tab titles, URLs, windows and last-access times to list recently used tabs, switch to a chosen tab, detect tabs with identical URLs, and find tabs that have not been used for 12+ hours. Also used to close tabs the user chooses and to reopen them on undo.
```

**tabGroups**
```
Reads the name and color of the user's tab groups to show them in the "all tabs" list. Groups are never changed.
```

**idle**
```
Reads only whether the user is active, idle or has locked the screen, so time away from the computer is not counted when grouping tabs by how long they have been unused.
```

**storage**
```
Saves the user's settings (switch scope, preview on/off) in local storage, and the recent-tab order and last-left times in session storage so the order survives a service worker restart.
```

**alarms**
```
Wakes the extension every 5 minutes to check for tabs idle longer than the user's chosen time (30 minutes to 6 hours) whose memory can be released.
```

**scripting**
```
Before releasing a tab's memory with chrome.tabs.discard, runs a one-off check in the page that returns only whether closing it would show the \"Leave site?\" dialog, so such tabs are skipped. No content is read or sent.
```

**nativeMessaging**
```
Talks only to the user's locally installed Neatab macOS helper (host app.neatab.helper). The helper captures Option+Tab and Cmd+Shift+C on every page, the address bar and chrome:// pages, which an extension cannot do, draws the switcher, and writes the copied link to the clipboard. No network involved.
```

**Host permission (<all_urls>)**
```
Required by chrome.tabs.captureVisibleTab to take a small preview image of the visible tab after the user settles on it, shown in the Option+Tab switcher. Previews stay on the device in memory and extension local storage (at most 10, expire after 7 days) and can be turned off, which deletes them. No content scripts are injected and no page content is read.
```

### Remote code

No, I am not using remote code.

### Data usage

Check nothing under "What user data do you plan to collect": nothing is collected or transmitted off the device. Tab URLs and titles are processed locally only. Certify all three statements (no selling, no unrelated use, no creditworthiness use).

- **Privacy policy URL**: https://github.com/iAlexKai/neatab/blob/main/PRIVACY.md

## Distribution

- Visibility: Public
- Regions: All regions

## Notes for reviewers (Test instructions)

```
Tab tidying works without any extra software: click the Neatab icon, then "所有标签页" (all tabs, close duplicates) or "不活跃标签页" (inactive tabs grouped by idle time).
Option+Tab switching and Cmd+Shift+C need the optional macOS helper: https://github.com/iAlexKai/neatab/releases/latest (install steps in the repository README). Without it the popup shows "下载辅助程序" and the tidying features keep working.
```
