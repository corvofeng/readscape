# 架构与适配器

阅境（Readscape）是可扩展的网页阅读增强脚本项目，使用 Node 构建独立的油猴脚本。网站适配与界面呈现可以按各站特点扩展，不绑定某个网站或某种视觉风格。当前包含 NGA 适配器；其他网站可新增独立适配器。它不需要服务器，也不需要手机安装 Node。当前交付的是 userscript，并非 Chrome 扩展安装包。

## 模块与分类

| 文件 | 职责 |
| --- | --- |
| `src/core/navigation.js` | 原生链接过渡、跨页恢复、超时和返回清理 |
| `src/core/settings.js` | 通用悬浮按钮、字体 / 字号 / 配色与设置面板 |
| `src/core/post-cache.js` | IndexedDB 缓存：帖子、回复页、封面地址、收藏与列表索引 |
| `src/adapters/nga/manifest.json` | 域名、页面路径、分类、存储键与模块清单 |
| `src/adapters/nga/index.js` | NGA 列表解析、错落卡片、收藏、原站跳转和生命周期 |
| `src/adapters/nga/reader.js` | NGA 正文 / 楼层解析、分页、引用与回复关系 |
| `src/adapters/nga/list.css` / `reader.css` | 列表和评论的桌面 / 手机样式 |
| `scripts/build.mjs` | 汇总模块、样式和元数据，生成独立油猴脚本并检查语法 |
| `scripts/new-adapter.mjs` | 新网站的适配器骨架，不覆盖已有文件 |
| `scripts/list-adapters.mjs` | 按分类列出适配器 |
| `tests/` | 列表、评论、设置、视口和导航回归测试 |

网站隔离在 `src/adapters/<id>/`，公共能力放在 `src/core/`。`category` 用于分类，可约定 `forum`（论坛）、`article`（文章）、`community`（内容社区）、`other`（其他）。当前 NGA 为 `forum`。各网站单独生成 `readscape-<id>.user.js`，避免一份全站脚本占用不相关网页。

## 新增网站

```sh
npm run new-adapter -- example example.com
```

1. 修改新目录的 `manifest.json`：域名、支持的精确页面路径、分类与独立存储键。构建器生成 HTTPS 匹配规则；运行时导航范围由 `hosts` 和 `paths` 共同限定。
2. 实现 `index.js` 中的 `runAdapter({ navigation })`：该网站的 DOM 解析、阅读界面和原版恢复。骨架没有现成的网站解析逻辑。
3. 可调用 `mountSettings({ shadow, app, prefs, save, change, original })` 接入公共面板：`app` 是阅读容器，`prefs` 是设置对象，`save()` 保存，`change()` 重绘，`original()` 切回原版。返回的 `visibility()` 管理悬浮按钮。目前面板包含论坛功能开关；非论坛可进一步裁剪选项。
4. 页面可读后调用 `navigation.finish()` 撤下过渡层。不要执行抓取页面中的脚本；登录与验证仍由原站处理。
5. 可在 manifest 的 `modules` / `styles` 定义源文件，通过 `/* NAME_MODULE */` / `/* NAME_CSS */` 占位合并。CSS 占位用于 JavaScript 字符串表达式。
6. 加入该网站的真实结构样本与测试，然后 `npm run build -- example`，安装 `dist/readscape-example.user.js`。

目前的导航路径识别针对固定 pathname；若新网站使用动态路径（例如 `/article/123`）或 SPA，需要扩展 matcher 和该站路由生命周期，不能只填写 NGA 选择器。
