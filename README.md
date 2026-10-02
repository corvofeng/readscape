# 阅境 / Readscape

为不同网站打造更舒适的阅读界面。当前内置 NGA 适配器：卡片列表、正文与回复阅读、字体配色设置和手机布局。不需要服务器，交付为油猴脚本（userscript），不是 Chrome 扩展安装包。

## 预览

| PC 列表 | PC 阅读 |
| --- | --- |
| ![PC 列表](https://github.com/user-attachments/assets/4f77c848-26ca-4c70-a057-409ea29f8f2b) | ![PC 阅读](https://github.com/user-attachments/assets/dc7edc0e-c7fc-4ccf-a4a7-b758c57ee57b) |

| 手机列表 | 手机阅读 |
| --- | --- |
| ![手机列表](https://github.com/user-attachments/assets/be28a8a6-71e0-4492-9a62-b2f7f55a8e69) | ![手机阅读](https://github.com/user-attachments/assets/4865acaf-cb1b-4de5-866c-1d90840e3649) |

列表为瀑布流卡片：封面按图片自身比例显示，标签与标题在图片下方；阅读为首楼图文笔记 + 逐页评论。13 秒演示视频见 [issue #1](https://github.com/corvofeng/readscape/issues/1)（列表 → 滚动 → 点击 → 阅读 → 返回）。预览图与视频统一托管在 issue #1，仓库不保存媒体副本。

## 安装

- **仓库公开后（零配置）**：运行 `npm run install-url` 打印 raw 安装地址，粘贴到浏览器即触发油猴安装；之后提高版本并推送 `v*` 标签，油猴按 `@updateURL` 自动检查更新（只有打 tag 才会更新 `dist` 分支）。
- **手动安装**：使用仓库内的 `dist/readscape-nga.user.js`，或从安装包解压 `readscape-nga.user.js`；在油猴里新建脚本并完整替换代码后保存、刷新网页。更新已有脚本时请在原脚本内替换代码。
- 不要同时启用两个 NGA 阅读脚本。脚本显示名称为「阅境 · NGA」。

## 使用

- **列表**：打开板块页即得到卡片列表；接近底部自动加载下一页，也可手动“加载下一页”。顶部可搜索、切换“热议 / 收藏”。优先显示 IndexedDB 缓存，再后台读取最新列表；默认在页面可见时约每 10 秒自动刷新，等滚动和点按结束后应用变化；阅读设置可关闭自动刷新，改为点击“更新列表”。列表到顶后继续下拉、松手可立即刷新。更新时保留当前帖子的屏幕位置，打开帖子期间暂停列表更新。新卡片淡入、收藏与加载反馈尊重系统减少动态效果设置。
- **阅读**：点击卡片在后台加载评论，就绪后进入阅读界面；浏览器返回即回到原列表和原滚动位置。楼层号、回复与引用均保留原站链接。
- **设置**：右上角菜单或右下角悬浮按钮打开面板，可调字号（85%–140%）、字体、配色、手机单双列、关联对话、平滑跳转；调整时实时预览。
- **收藏与缓存**：卡片上的 ♡ 收藏帖子；设置面板可查看缓存用量、调整帖子上限或一键清理（保留收藏与阅读偏好）。
- 完整行为说明见 [功能与行为细节](docs/features.md)。

## 下载与调试

- **正式版**：`dist/readscape-nga.user.js`，或 CI 发布到 `dist` 分支的 raw 地址（见 [开发指南](docs/development.md#cicd-与油猴自动更新)）。
- **开发自动刷新**：`npm run dev` 后打开服务首页，点击“安装 / 更新开发脚本”；修改 `src/` 自动重新构建并刷新已打开的 NGA 页面。
- **远端浏览器联调**：`scripts/dev-browser.sh <CDP地址>` 检查浏览器，`CDP_URL=... node scripts/verify-tm.mjs` 新开页面验证并截图。
- **构建与测试**：`npm ci && npm run check`（构建 + 语法检查 + 全部回归测试）。
- 以上流程的完整参数与边界见 [开发指南](docs/development.md)。

## 文档

- [功能与行为细节](docs/features.md) — 设置、列表、阅读、缓存与跳转边界
- [存储模型设计](docs/storage-model.md) — IndexedDB 表结构、生命周期与迁移
- [架构与适配器](docs/architecture.md) — 模块职责与新增网站适配器
- [开发指南](docs/development.md) — 构建、测试、CI/CD、油猴联调与开发服务
- [变更历史](docs/changelog.md) — v3.0 变更明细
- [远端浏览器调试记录](docs/remote-browser-debugging.md)
