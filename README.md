# 阅境 / Readscape · v3.0

为不同网站打造更舒适的阅读界面。

阅境（Readscape）是可扩展的网页阅读增强脚本项目，使用 Node 构建独立的油猴脚本。网站适配与界面呈现可以按各站特点扩展，不绑定某个网站或某种视觉风格。当前包含 NGA 适配器，提供卡片列表、正文与回复阅读、字体配色设置和手机布局；其他网站可新增独立适配器。它不需要服务器，也不需要手机安装 Node。当前交付的是 userscript，并非 Chrome 扩展安装包。

## 直接安装

从安装包解压 `readscape-nga.user.js`，打开油猴原有脚本，将旧代码完整替换成新代码后保存并刷新网页。不要同时启用两个 NGA 阅读脚本。脚本显示名称为「阅境 · NGA」，更新已有脚本时请在原脚本内替换代码。也可以使用项目中的 `dist/readscape-nga.user.js`。

右下角圆角齿轮打开设置：字号 85%–140%、系统 / 宋体 / 圆润字体、明亮 / 暖纸 / 深色配色、手机单双列、关联楼层回复、平滑跳转。设备缺少选定字体时自动回退到已有字体。设置与收藏保存在本浏览器、当前网站域名的 localStorage，跨 NGA 域名不会同步。

手机列表默认双列，开启“手机单列”后为单列。评论逐页加载。关联模式只归并同页单一明确引用的回复，多重引用与跨页回复保留各自楼层；查看原楼可以按需加载所在页。

为保留旧版设置、收藏及脚本识别，NGA 适配器沿用旧版的存储键和 userscript namespace；这些内部兼容标识不作为项目名称。

## 本次修复

- 优先解析 `a.topic` / 标题 ID，排除回复时间、回复数和分页链接，防止卡片标题显示“今天 13:59”。
- 置顶识别按完整样式类匹配，避免把普通 `topicrow` 中的 `top` 误判成置顶。
- 限制手机容器和网格宽度；阅读视口使用 `width=device-width`，监听原站后续视口改写。
- 新增桌面和手机通用设置面板，支持键盘焦点循环、Esc 关闭、恢复默认。
- 页面点击保留原生导航，以加载层遮住中间页，原站正常就绪后撤下。浏览器返回恢复时清理加载层。

## 跳转的边界

加载层只改视觉呈现，不取消服务器跳转、不缩短网络等待、不绕过访客访问流程。脚本仍自动点击 NGA 原有“如不能自动跳转 可点此链接”，两分钟内最多尝试两次。加载层 12 秒后自动撤下，也可点击“显示原页”。

普通左键 / 单指点击本站已适配的链接会开启过渡；外部链接、Ctrl / Cmd 点击、下载链接和新窗口链接保持浏览器原有处理。过渡记录在 sessionStorage，存储不可用或油猴注入较晚时，仍可能短暂看到原页面。这里没有伪造 history 或用 AJAX 全站替换页面，因此原站登录、回复与浏览器返回仍走原有流程。

## Node 构建与测试

建议 Node 24 LTS，版本至少 24.15。构建只使用 Node 自带模块，测试使用 jsdom。

```sh
npm ci
npm run check
npm run build -- nga
npm run list
```

`npm run build` 构建全部适配器，`npm run build -- nga` 只构建 NGA。产物位于 `dist/`。编辑 `src/` 后重新构建；不要修改产物，否则下次构建会覆盖。

## 模块与分类

| 文件 | 职责 |
| --- | --- |
| `src/core/navigation.js` | 原生链接过渡、跨页恢复、超时和返回清理 |
| `src/core/settings.js` | 通用悬浮按钮、字体 / 字号 / 配色与设置面板 |
| `src/adapters/nga/manifest.json` | 域名、页面路径、分类、存储键与模块清单 |
| `src/adapters/nga/index.js` | NGA 列表解析、预览、收藏、原站跳转和生命周期 |
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

## 验证范围

通过 Node 语法检查、完整 DOM 回归测试，以及回复时间先于标题、置顶误判、设置持久化、恢复默认、视口改写、跳转恢复 / 超时 / 返回等专项测试。构建无需下载依赖；`npm ci` 的依赖只用于测试。

尚未完成实际手机浏览器的视觉实测。之前云浏览器无法安装油猴，且本地预览受浏览器策略限制，因此没有把 DOM 测试描述为真机验证。

参考官方文档：[Tampermonkey](https://www.tampermonkey.net/documentation.php)、[Node 文件 API](https://nodejs.org/api/fs.html)。
