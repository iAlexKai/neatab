# Seven · 最近 7 个标签页

在 macOS Chrome 中复刻 Arc 最近标签切换的键盘交互。由 Manifest V3 扩展 + 一个 AppKit 原生辅助程序组成，不需要重启 Chrome。

**1.5.0 新增：不活跃标签页按 48 小时以上、24–48 小时、12–24 小时、12 小时以内分组，可全部关闭或按组关闭。**

1.4.0：所有标签页与关闭重复页，重复打开的页面只保留最近活跃的一个。

1.3.0：不活跃标签页，列出超过 12 小时未访问的标签页，可一键全部关闭。

1.2.0：复制成功后显示「已复制页面链接」，1.2 秒后自动消失。

Command + Shift + C 复制当前网页的完整链接。

Arc 官方确认显示最近 **5** 个标签页，默认快捷键是 **Control + Tab**。Seven 按本项目的要求使用 **Option + Tab**，显示最近 **7** 个（含当前页）。原文：[Arc 官方说明](https://resources.arc.net/hc/en-us/articles/25619402657303-How-Do-You-Switch-Between-Tabs-Quickly-on-Arc-Desktop)。这里的「相近上下文」按最近实际访问顺序判断，与 Arc 一样，不分析网页内容的语义相似度。

## 安装

适用于 macOS 13 或更新版本、Chrome 121 或更新版本。交付包是本机架构编译的版本，当前架构见压缩包文件名。辅助程序为本地临时签名，尚未经过 Apple 公证或 Chrome 商店审核。

1. 解压 `Seven-macOS-*.zip`，双击 **安装 Seven.command**。安装脚本会把文件复制到稳定位置，注册仅供此扩展使用的 Chrome Native Messaging host。
2. 在 Chrome 打开 `chrome://extensions`，开启右上角的**开发者模式**，点击**加载已解压的扩展程序**，选择：

   `~/Library/Application Support/Seven/seven-extension`

   文件选择框中可按 `Command + Shift + G` 粘贴上述路径。
3. 点击 Seven 扩展图标 → **开启辅助功能权限**，在系统设置 → 隐私与安全性 → 辅助功能中允许 **Seven**。若列表中没有 Seven，可用 `+` 添加 `~/Applications/Seven.app`。返回扩展，等待显示「已就绪」。

首次安装的终端脚本可能要求在系统设置中允许 Terminal 访问文件；辅助功能权限必须由本人手动开启。若系统阻止本地未公证软件运行，请按系统提供的正规批准流程处理。

安装后的文件：

- 辅助程序：`~/Applications/Seven.app`
- 扩展：`~/Library/Application Support/Seven/seven-extension`
- Chrome host 注册：`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/app.seven.switcher.json`

卸载时先在 Chrome 移除扩展，再运行交付包中的 **卸载 Seven.command**。脚本只删除上述 Seven 文件，系统中的辅助功能授权可手动移除。

已安装旧版时，关闭 Seven 的连接或暂时停用扩展，运行新版安装脚本，然后在 `chrome://extensions` 点击 Seven 的重新加载按钮。原生辅助程序也必须更新；若系统要求重新授予辅助功能权限，按系统提示操作。

**更新排查（1.1.1）：**扩展面板会显示扩展和辅助程序各自的版本。辅助程序仍为 1.0.0 时，面板会提示先更新；单独重新加载 extension 不会替换系统中的 `Seven.app`。若新版仍显示未授权，请在系统设置的辅助功能列表中用 `−` 移除旧 Seven，再用 `+` 添加 `~/Applications/Seven.app` 并开启，随后回 Chrome 重新加载 Seven。当前开发包使用临时签名，系统可能保留上一版的程序身份；仅关闭再开启旧授权项不足以刷新该身份。

## 使用

| 操作 | 行为 |
| --- | --- |
| 按住 Option，按一次 Tab | 选中上一个访问的标签页 |
| 继续按 Tab | 在冻结的最近 7 个列表中向后选择 |
| Option + Shift + Tab | 反向选择，也可直接反向打开 |
| 松开 Option | 激活选中标签页并更新最近顺序 |
| Esc | 取消，停留在原标签页 |
| Enter / 点击卡片 | 确认切换 |
| Option + 左右箭头 | 在已打开的切换器内移动 |
| Command + Shift + C | 复制当前网页的完整链接到剪贴板 |

复制链接保留原地址的查询参数和 `#` 锚点，不附加标题，也不会切换页面。成功写入剪贴板后，Chrome 所在屏幕底部显示「已复制页面链接」，1.2 秒后自动消失；连续复制会刷新同一条提示的停留时间，不叠加、不抢焦点，切到其他应用时隐藏。地址来自按键时对 Chrome 当前活动标签页的查询，而非预览缓存。该组合键在 Seven 就绪时用于复制链接；普通 Command + C 仍用于复制选中内容。不新增扩展权限。

连续短按 Option + Tab 可以在最后两页之间来回切换。列表按访问时间排列，与标签栏顺序无关。首次加载扩展时会用 Chrome 的 `lastAccessed` 重建最近顺序；之后只按实际激活更新。后台新建的标签页在首次访问前不会插入最近列表。

默认包含此 Chrome 配置文件的所有普通窗口，可在扩展面板改为「当前窗口」。地址栏、普通网页、Chrome 新标签页和 `chrome://` 页面都由原生键盘监听覆盖；这些内部页面可作为目标，但预览显示标题与域名卡片。无痕窗口不参与，切到别的应用不会接管按键。

## 整理标签页

点击扩展图标 → **所有标签页** 或 **不活跃标签页**，打开同一个整理页面，顶部可在两个视图间切换。再次点击会复用已打开的整理页。

### 所有标签页与关闭重复页

按窗口、按标签栏顺序列出所有普通窗口中打开的标签页。完整地址相同（含查询参数和 `#` 锚点）即为重复；跨窗口的重复也算。

- 每组重复页保留**最近活跃**的一个：正在显示的标签页优先，其次是最后活跃时间最晚的。列表中标为「重复 · 保留」或「重复 · 将关闭」。
- **关闭重复页 (N)** 一次关闭所有标为「将关闭」的标签页。正在显示、已固定、正在播放声音的副本不会被关闭。
- 关闭时重新计算：页面打开后又被访问、或已跳转到别的地址的标签页，不会按旧判断被关闭。

### 不活跃标签页

参照 Arc 自动归档闲置标签页的做法，但不会自动关闭：列出所有普通窗口中可关闭的标签页，按多久没有切换到分为四组，最久未访问的排在最前：

| 分组 | 未访问时长 |
| --- | --- |
| 48 小时以上 | ≥ 48 小时 |
| 24 – 48 小时 | ≥ 24 且 < 48 小时 |
| 12 – 24 小时 | ≥ 12 且 < 24 小时 |
| 12 小时以内 | < 12 小时 |

- **全部关闭 (N)** 一次关闭超过 12 小时未访问的标签页，即前三组；不包括「12 小时以内」。
- 每组标题右侧 **关闭本组** 只关闭这一组，「12 小时以内」也可以按组关闭。没有标签页的组不显示。
- 弹窗和视图切换上的数字是超过 12 小时未访问的数量。
- 不会列出：各窗口当前显示的标签页、已固定的标签页、正在播放声音的标签页、无痕窗口。
- 关闭时会重新检查：页面打开后又被访问过、已不属于该组时长的标签页不会被关闭；时间推移落入更久分组的仍会关闭。

### 两个视图通用

- 点击行切换到该标签页，每行右侧 × 单独关闭。
- 关闭后底部提示「已关闭 N 个标签页 · 撤销」，8 秒内可撤销，在原窗口原位置重新打开这些地址（不恢复页面内的前进/后退记录；Chrome 的 ⌘ ⇧ T 仍可用）。部分 `chrome://` 内部页面不能由扩展重新打开。

「最后活跃时间」取两者中较晚的一个：Chrome 记录的 `lastAccessed`，以及 Seven 观察到你离开该标签页的时间（停留在一个标签页上的时长也算活跃）。离开时间保存在 session 存储中，Chrome 重启后只使用 `lastAccessed`。不新增扩展权限。

## 性能与预览

切换热路径只有：从内存读取最多 7 项 → 绘制原生卡片 → 松键后向 Chrome 发送激活请求。按住时不会激活中间标签页，也不会请求截图、网络或页面重载。无需给每个网页注入脚本。

预览在激活后停稳 900 ms 才尝试生成；同页 15 秒内不重复生成。全局捕获间隔至少 1.1 秒，低于 Chrome 的每秒 2 次限制。每张 JPEG 为 384 × 240，最大 90 KB，只缓存当前最近列表的最多 7 张，Chrome Service Worker 退出后释放。关闭「网页预览」会清空缓存。尚未生成预览的页面显示域名卡片；并不是实时视频预览。

扩展菜单中的**查看本机性能**会显示本次连接最近 100 次操作的两项 P95：

- 按键处理到原生绘制提交的耗时；不包含显示器扫描输出。
- 松键到 Chrome 激活 API 返回的耗时；不代表网页已完成绘制。

性能是否追平 Arc，需要在同一机器、相同标签页与 Chrome 内存节省配置下实测。当前自动测试不构成与 Arc 的端到端性能对比。Chrome 已休眠的标签页在激活时仍需恢复，其等待时间由 Chrome 和目标网页决定。macOS 的安全输入模式可能限制系统键盘监听。

## 权限与数据

- `tabs`：读取标签标题、地址和访问时间，选择目标标签；关闭不活跃或重复的标签页并在撤销时重新打开。
- `<all_urls>`：使用 Chrome 的可见标签截图 API；没有网页内容脚本，不注入网页。
- `nativeMessaging`：仅与本机 Seven 辅助程序通信。
- `storage`：设置保存在本地；最近标签 ID 使用 session 存储。
- macOS 辅助功能：接收按键与松键，只在 Chrome 普通窗口前台响应指定组合，不记录输入文本。
- 剪贴板：仅在 Command + Shift + C 触发时，把当前网页链接作为纯文本写入系统剪贴板；不读取或上传原有剪贴板内容。

页面预览和性能样本只保存在进程内存中。没有后端、账号、分析脚本、远程图标服务或数据上传。不读取 Chrome 浏览历史数据库。

## 开发与验证

构建只依赖 Node.js 和 macOS Xcode Command Line Tools，无 npm 依赖：

```sh
npm test
npm run build
node tests/native-wire.mjs
build/Seven.app/Contents/MacOS/Seven --clipboard-self-test
npm run package
```

`npm test` 覆盖 MRU、跨窗、关闭目标、无痕隔离、消息来源验证、截图暂停，以及查询乱序和截图编码期间的设置/导航变化。`build` 自动运行原生状态机与帧协议检查。`tests/native-wire.mjs` 启动真实 host，测试分片 UTF-8 管道、快照更新、回复与正常退出，不启用切换或申请权限；AppKit 启动需要 macOS 图形会话。

复制链接测试覆盖最新前台标签、长链接、参数/锚点保留、无痕隔离和查询期间切换窗口。原生 `--clipboard-self-test` 使用独立测试剪贴板验证真实 AppKit 写入，不读取或覆盖用户的系统剪贴板。

`node scripts/preview-server.mjs` 启动本机虚构数据 UI 预览（端口 4177），不连接真实标签页。原生静态布局可用：

```sh
build/Seven.app/Contents/MacOS/Seven --render-fixture build/seven-preview-light.png
build/Seven.app/Contents/MacOS/Seven --render-fixture build/seven-preview-dark.png --dark
```

安装后的真实验收清单见 `VALIDATION.md`。只有真实浏览器验收和性能对比完成后，才能宣称全目标完成。

## 实现依据

Chrome Commands API 不接受 Tab 作为声明式扩展快捷键，且扩展无法在所有浏览器 UI 上获取修饰键松开事件，所以采用原生 host 完整接管 Option + Tab，而没有用其他快捷键替代。参考：[Commands API](https://developer.chrome.com/docs/extensions/reference/api/commands)、[Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)、[Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)。
