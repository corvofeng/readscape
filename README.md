# 阅境 / Readscape（公开试用版）

为不同网站打造更舒适的阅读界面。当前内置 NGA 社区适配器：卡片列表、沉浸式正文与逐页评论阅读、字体配色设置和手机响应式布局。
无需服务器，交付为纯前端油猴脚本（Userscript），无需安装独立浏览器扩展包。

> [!NOTE]
> 当前处于**公开试用版**阶段，核心阅读、缓存流转、返回滚动位置与降级逻辑已通过 90 项自动化与 DOM 回归测试。欢迎安装体验并反馈使用体验与兼容问题。

---

## 快速安装

普通用户无需克隆仓库或运行命令行，在浏览器中即可一键安装。

### 1. 前置准备
确保浏览器已安装以下任一用户脚本管理器扩展：
- **桌面端**：[Tampermonkey (篡改猴)](https://www.tampermonkey.net/)（推荐）/ [ScriptCat (脚本猫)](https://scriptcat.org/) / [Violentmonkey (暴力猴)](https://violentmonkey.github.io/)
- **Android 端**：Edge（已支持安装扩展插件）、Kiwi 或 Firefox Mobile + Tampermonkey / 暴力猴
- **iOS 端**：Safari + Stay / Userscripts

### 2. 一键安装
点击下方链接，油猴扩展将自动弹出安装确认窗口，点击**「安装」**或**「更新」**即可：

👉 **[点击一键安装：阅境 · NGA（自动更新版）](https://raw.githubusercontent.com/corvofeng/readscape/dist/readscape-nga.user.js)**

安装完成后，打开或刷新任意 [NGA 论坛页面](https://bbs.nga.cn/)（如板块列表、帖子正文）即可生效。

### 安装说明与排查
- **Chrome / Chromium 浏览器**：若点击链接未弹出油猴安装页面，请进入 `chrome://extensions`，找到 Tampermonkey 并开启「开发者模式」及「允许用户脚本运行」权限。
- **固定版本（禁用自动更新）**：如果希望锁定版本，可前往 [Releases 页面](https://github.com/corvofeng/readscape/releases) 下载 `.user.js` 附件，或访问 [dist 分支版本归档](https://github.com/corvofeng/readscape/tree/dist)。
- **避免冲突**：请勿与其他 NGA 论坛美化或重排脚本同时开启。本脚本在扩展中显示名称为「阅境 · NGA」。

---

## 预览与界面

| PC 列表 | PC 阅读 |
| --- | --- |
| ![PC 列表](https://github.com/user-attachments/assets/4f77c848-26ca-4c70-a057-409ea29f8f2b) | ![PC 阅读](https://github.com/user-attachments/assets/dc7edc0e-c7fc-4ccf-a4a7-b758c57ee57b) |

| 手机列表 | 手机阅读 |
| --- | --- |
| ![手机列表](https://github.com/user-attachments/assets/be28a8a6-71e0-4492-9a62-b2f7f55a8e69) | ![手机阅读](https://github.com/user-attachments/assets/4865acaf-cb1b-4de5-866c-1d90840e3649) |

- **列表呈现**：瀑布流卡片，封面按图片比例预留占位不跳动，标签与标题置于封面下方。
- **阅读呈现**：首楼图文笔记（桌面端左图右文 / 手机端横滑图集）+ 逐页按需加载评论。
- **实机运行截图**：仓库内保存了远端真实 Chromium 环境的调试运行截图：[docs/assets/nga-remote-dev.png](docs/assets/nga-remote-dev.png)。
- **演示视频**：真实 NGA 操作演示视频（列表滚动 → 点击开帖 → 逐页阅读 → 原位置返回）将在公开后于 [issue #1](https://github.com/corvofeng/readscape/issues/1) 重新上传更新。

---

## 手机端体验与兼容状态

手机端用的是网页自身的滚动：下滑收起阅读顶栏、上滑恢复，把屏幕让给正文。列表到帖子是正常页面跳转，浏览器原生返回键就能回到列表原位，不用找页面上的返回按钮。

手机端同样完美支持！Android 端可以用 Edge（已支持安装扩展插件）、Kiwi 或 Firefox Mobile 装上 Tampermonkey / 暴力猴，再装阅境；iOS 端用 Safari 配合 Stay 或 Userscripts 扩展直接加载。我现在的日常场景就是晚上窝在被窝里用 iPhone Safari 刷 NGA 复盘帖，瀑布流滑动、图集横滑、返回原位一路丝滑。

| 环境 | 状态 |
| --- | --- |
| macOS / Linux / Windows 的 Chrome / Edge / Brave + Tampermonkey 5.5+ | 真机实测通过 |
| Android：Edge / Kiwi / Firefox Mobile + Tampermonkey / 暴力猴 | 真机实测通过 |
| iOS：Safari + Stay / Userscripts | 真机实测通过 |

- **卡片布局取舍说明**：
  - 瀑布流大卡片对于图文丰富、二次元或生活类讨论板块有较好的视觉沉浸感；
  - 但在纯文字讨论区，大卡片会降低首屏信息密度。后续版本计划增加**紧凑文字列表**视图供用户自由切换。

---

## 核心功能与使用

- **列表**：打开板块页即呈现卡片列表；接近底部自动追加下一页，支持顶部搜索、热议/收藏筛选；优先展示 IndexedDB 本地缓存，再在后台静默同步最新列表；页面在顶端时下拉松手可立即刷新。阅读帖子返回时精准恢复原列表位置。
- **阅读**：点击卡片后台平滑加载，就绪后切换阅读视图；首楼图文笔记排版，逐页评论按需翻页；原站楼层号、回复与引用链接完整保留。
- **个性化设置**：右上角菜单或右下角浮动按钮打开抽屉面板，可实时调整字号（85%–140%）、排版字体、浅色/深色主题、手机单双列、平滑跳转等，设置持久保存。
- **收藏与缓存**：卡片一键点击 ♡ 收藏；设置面板内置缓存管理器，可查看本地占用容量、调整帖子缓存上限或一键清理（清理不会影响收藏与阅读偏好）。
- 详见 [功能与行为细节](docs/features.md)。

---

## 开发者与调试

- **仓库架构**：产物集中在独立的 `dist` 分支；`main` 分支纯源码；`npm run build` 生成的本地 `dist/` 默认忽略。
- **本地开发**：`npm run dev` 启动开发服务，修改 `src/` 源码自动构建并触发浏览器页面刷新。
- **远端联调**：支持跨机器 CDP 调试（`scripts/dev-browser.sh` 与 `scripts/verify-tm.mjs`）。
- **安装地址生成**：开发者如需生成或查看安装地址，可运行 `npm run install-url`（公开仓库默认生成干净的 raw 直链）。
- **自动化测试**：运行 `npm run check` 执行全量构建、产物语法检查与 90 项端到端及模块回归测试。
- 更多请参考 [开发指南](docs/development.md)。

---

## 相关文档

- [功能与行为细节](docs/features.md) — 设置、列表、阅读、缓存与跳转边界
- [存储模型设计](docs/storage-model.md) — IndexedDB 表结构、生命周期与迁移
- [架构与适配器](docs/architecture.md) — 模块职责与新增网站适配器
- [开发指南](docs/development.md) — 构建、测试、CI/CD、油猴联调与开发服务
- [变更历史](docs/changelog.md) — v3.0 变更明细
- [远端浏览器调试记录](docs/remote-browser-debugging.md) — 实机连接与调试日志
