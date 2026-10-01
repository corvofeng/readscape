# 阅境 / Readscape · v3.0

为不同网站打造更舒适的阅读界面。

阅境（Readscape）是可扩展的网页阅读增强脚本项目，使用 Node 构建独立的油猴脚本。网站适配与界面呈现可以按各站特点扩展，不绑定某个网站或某种视觉风格。当前包含 NGA 适配器，提供卡片列表、正文与回复阅读、字体配色设置和手机布局；其他网站可新增独立适配器。它不需要服务器，也不需要手机安装 Node。当前交付的是 userscript，并非 Chrome 扩展安装包。

## 直接安装

从安装包解压 `readscape-nga.user.js`，打开油猴原有脚本，将旧代码完整替换成新代码后保存并刷新网页。不要同时启用两个 NGA 阅读脚本。脚本显示名称为「阅境 · NGA」，更新已有脚本时请在原脚本内替换代码。也可以使用项目中的 `dist/readscape-nga.user.js`。

右上角菜单未登录时提供“登录”，登录后显示当前用户名与 UID，点按可展开用户资料卡；菜单也提供“阅读设置”，右下角设置按钮也可打开紧凑面板。默认展开字号与字体，其他选项收在“更多设置”中；调整时页面可继续滚动并实时预览。支持：字号 85%–140%、系统 / 宋体 / 圆润字体、明亮 / 暖纸 / 深色配色、手机单双列、关联对话（关闭时按楼层顺序）、平滑跳转。设备缺少选定字体时自动回退到已有字体。设置保存在 localStorage，收藏和缓存保存在 IndexedDB，均属于本浏览器的当前网站域名，跨 NGA 域名不会同步。

手机端使用网页自身滚动，下滑收起阅读顶栏，上滑恢复，为 Safari 地址栏随滚动收起保留原生滚动行为。手机列表到帖子采用正常页面跳转，避免固定 iframe 阻碍沉浸阅读；桌面端保留后台加载评论。Safari 地址栏的实际表现仍由浏览器控制，目前已验证 Chrome 手机视口，尚未实测 iPhone Safari。

手机列表默认双列，按标题长度形成错落排列，不再重复显示标题或提供首楼预览；开启“手机单列”后为单列。楼层号保留原站链接，评论底部不再重复显示“原楼链接”。评论逐页加载。关联模式只归并同页单一明确引用的回复，多重引用与跨页回复保留各自楼层；查看原楼会优先定位已缓存的楼层，再按需加载所在页；缺少或失效的页码可回查前 500 条评论。下一页的原始 BBCode（引用、回复关系、表情、图片与常用排版）直接转换为阅读内容，不执行返回页面的脚本。

为保留旧版设置、收藏及脚本识别，NGA 适配器沿用旧版的存储键和 userscript namespace；这些内部兼容标识不作为项目名称。

## 本次修复

- 列表封面与正文图片不再下载入库：只记录原图地址，图片交给浏览器 HTTP 缓存，去掉图片 Blob 存储、配额与下载权限（`GM_xmlhttpRequest` / `@connect`）。已安装的正式版重新安装后生效。
- 回复与引用复用原站按钮链接和延迟生成的按钮模板，保留 `_newui`、`fid`、`tid`、`pid`、`article`，避开手机端页内编辑窗口。
- 设置面板沿入口位置展开、收起，尊重系统减少动态效果设置；关闭途中重新打开不会被旧动画关闭。
- 通过油猴的 `unsafeWindow` 读取当前页面用户缓存，补充 UID 来源和延迟资料更新；有 UID 的未加载作者显示 UID，真实匿名作者仍保留匿名。已有开发加载器需重新安装以获得新增授权。

- 点按帖子作者、头像或当前账号，可展开资料卡：头像、用户名与 UID、注册时间（北京时间）、等级、威望、发帖数和财富。使用原页用户资料；缺少资料时按需读取该 UID 的原版个人资料页，结果缓存于当前阅读页面。头像加载失败时保留文字头像，读取失败时保留原版资料入口。

- 登录状态以原页 `__CURRENT_UID` / `__CURRENT_UNAME` 为准；`commonui.userInfo.setAll(...)` 只按当前 UID 补全名称，不把帖内其他作者识别为登录用户。支持信息晚到和登出后恢复登录入口。
- 手机端改为文档滚动，向下阅读收起顶栏，上滑恢复；布局切换、字体调整和切回原版时保留各自滚动位置。

- 增加文字卡片的四周留白和标签与标题之间的间距，放大字号后仍保留内边距。登录入口移至右上角菜单，点击后打开原站登录流程；未找到登录入口时显示原页账号操作。

- 回复帖子、跳到评论、回到顶部收进设置抽屉，保留紧凑的楼层回复、引用入口，移除固定底部回复栏。“回复帖子”使用原站发表回复链接；每层提供回复、引用链接，均在顶层页面跳转至原版发帖页，登录校验由发帖页处理。
- 单页帖子和已到末页的评论直接显示“已经到底了”，隐藏加载按钮；分页信息晚到时自动更新。设置使用不遮罩、不锁定页面的紧凑面板，移动端位于底部、桌面端位于右下角，高度最多占视口 45%，支持下拉把手关闭、开关控件和实时字号百分比。
- 阅读模式完全隐藏原页 `body`，只渲染独立顶层阅读容器；手机端由文档承载滚动，桌面端使用固定阅读容器。手机和桌面端评论就绪后隐藏并暂停底下的列表交互，退出帖子或浏览器返回时继续使用原列表及其滚动位置，无需逐帖保存位置；切回原版恢复原页样式和位置。
- 正文超链接去掉 NGA 自动生成的警告框、悬停网址及装饰括号，保留链接名称和真实地址；外链增加新窗口标识，优化下划线、悬停、键盘焦点及三种配色。

- 正文图片增加比例占位、加载淡入、失败重试和大图查看器；支持方向键翻图、Esc 关闭及原图入口。
- 首楼采用图文笔记布局：手机端作者、横滑图集、标题正文，桌面端左图右文。引用、折叠内容和表格中的图片保留原位；分页和排列切换复用未变化的图片节点。

- 优先解析 `a.topic` / 标题 ID，排除回复时间、回复数和分页链接，防止卡片标题显示“今天 13:59”。
- 置顶识别按完整样式类匹配，避免把普通 `topicrow` 中的 `top` 误判成置顶。
- 限制手机容器和网格宽度；阅读视口使用 `width=device-width`，监听原站后续视口改写。
- 新增桌面和手机通用设置面板，支持键盘焦点循环、Esc 关闭、恢复默认。
- 列表打开帖子或最新回复时，在同源后台阅读容器加载原站，当前列表保持可滚动、可操作，评论就绪后再显示。返回时恢复原列表和滚动位置；其他跳转仍使用原生导航过渡。
- 列表采用连续瀑布流：接近底部时自动追加下一页，也可点击“加载下一页”。已展示卡片保留节点和顺序，跨页重复帖子只展示一次；搜索和热议筛选覆盖已加载内容。失败时保留列表并提供重试及原站入口。
- 本地缓存统一使用 IndexedDB：帖子及首楼正文、回复页、封面地址、收藏关系和有序列表索引分别存表；localStorage 只保存阅读偏好与缓存配置。旧列表、封面和收藏自动迁移。默认缓存最多 500 帖、文字和索引 10 MB；图片不落库，只记录地址、交给浏览器缓存；详情见 [存储模型设计](docs/storage-model.md)。
- 打开帖子后，把楼主首楼第一张正文贴图登记为列表封面，排除表情及引用中的图片，支持正文折叠块和表格中的贴图。列表封面和正文图片直接引用原图地址，由浏览器 HTTP 缓存复用；地址按完整 URL 去重。封面图按自身宽高比显示在卡片顶部，标签与标题移到图片下方、不再叠在图上，瀑布流按实际高度排布；加载失败时回退为文字卡。封面登记同步写一条 pending 日志，页面在缓存提交前被刷新或关闭时下次加载自动回填，不会丢封面。
- 设置面板显示缓存总量估算、帖子和回复页数量；可开关缓存、调整帖子上限、一键清理。手动清理保留收藏书签与阅读偏好。
- 缓存按最后一次打开或列表访问续期；连续 7 天未访问的帖子缓存在空闲时异步删除，并每 30 分钟检查一次。帖子数或文字空间超限时淘汰对应缓存；缓存不可用时仍可正常阅读。清理只在脚本运行时进行，重新进入时会再次检查；收藏书签保留。

## 跳转的边界

后台阅读容器仍加载完整原站页面，不缩短服务器等待，也不绕过访客访问流程。脚本仍自动点击 NGA 原有“如不能自动跳转 可点此链接”，两分钟内最多尝试两次。后台加载时可以取消或直接打开原页；启动失败或 15 秒未就绪时自动改用原生导航。阅读界面由主页面初始化，不依赖油猴在子页面中执行。关闭“平滑跳转”后恢复原生打开方式。其他原生跳转的加载层在 12 秒后撤下，也可点击“显示原页”。

已安装开发加载器时，源码更新后自动刷新即可生效；正式版重新安装构建后的 `dist/readscape-nga.user.js`。

普通左键 / 单指点击本站已适配的链接会开启过渡；外部链接、Ctrl / Cmd 点击、下载链接和新窗口链接保持浏览器原有处理。过渡记录在 sessionStorage，存储不可用或油猴注入较晚时，仍可能短暂看到原页面。这里没有伪造 history 或用 AJAX 全站替换页面，因此原站登录、回复与浏览器返回仍走原有流程。

## Node 构建与测试

建议 Node 24 LTS，版本至少 24.15。构建只使用 Node 自带模块，测试使用 jsdom 和 fake-indexeddb。

```sh
npm ci
npm run check
npm run build -- nga
npm run list
```

`npm run build` 构建全部适配器，`npm run build -- nga` 只构建 NGA。产物位于 `dist/`。编辑 `src/` 后重新构建；不要修改产物，否则下次构建会覆盖。

## CI/CD 与油猴自动更新

GitHub Actions（`.github/workflows/ci-cd.yml`）负责持续集成与发布：

- **`verify`**：向 `main` 推送或提 PR 时运行 `npm ci && npm run check`（构建 + `node --check` 语法检查 + 全部测试），并把 `dist/*.user.js` 作为构建产物上传。
- **`publish`**：向 `main` 推送（或手动触发）时，构建脚本并强制推送到一个独立的 **`dist` 孤儿分支**（仓库根目录下的 `readscape-<id>.user.js`）。这个分支只放构建产物，与源码分离，提供稳定的 raw 更新地址。
- **Release**：推送 `v*` 标签时额外创建 GitHub Release，附上**不含 token** 的脚本，便于手动下载安装。

构建器为每个脚本写入 `@updateURL` / `@downloadURL`（外加 `@homepageURL` / `@supportURL`），指向 `dist` 分支的 raw 地址。油猴会定期比对 `@updateURL` 里的 `@version`，发现更高版本就从 `@downloadURL` 下载并替换脚本，从而实现自动更新。

### 私有仓库与 token

本仓库为 **private**。油猴检查更新时不带任何凭证，直接访问私有仓库的 raw 地址会返回 404。经验证，把只读 token 内嵌到 URL 的 userinfo 即可正常拉取：

```
https://<TOKEN>@raw.githubusercontent.com/corvofeng/readscape/dist/readscape-nga.user.js
```

因为油猴更新后会用新脚本的元数据覆盖旧元数据，token 必须存在于**被下载的文件里**，而不能只写在 `main` 源码中。做法是：`main` 源码保持不含 token，CI 在发布时从 Actions Secret 注入 token，只写入 `dist` 分支的产物。

配置步骤：

1. 在 GitHub 生成一个 **fine-grained Personal Access Token**，仅对本仓库授权、权限设为 **Contents: Read-only**（最小化泄露影响）。
2. 到仓库 `Settings → Secrets and variables → Actions` 新建 secret，名字为 `READSCAPE_UPDATE_TOKEN`，值为上面的 token。
3. 重新运行一次 `publish`（向 `main` 推送或在 Actions 里手动 `Run workflow`）。此后 `dist` 分支的脚本就带有 token，可自动更新。未配置该 secret 时，产物降级为不含 token（私有仓库下无法自动更新，CI 会给出 warning）。

### 首次安装（私有仓库）

本地执行下面的命令，它会用 `gh auth token`（或 `READSCAPE_UPDATE_TOKEN` / `GH_TOKEN`）拼出带 token 的安装地址：

```sh
npm run install-url            # 打印所有适配器的安装地址
npm run install-url -- nga     # 只打印 NGA
READSCAPE_OPEN=1 npm run install-url   # 打印并在浏览器打开（触发油猴安装）
```

把地址粘贴到浏览器即可触发油猴安装。安装后脚本内的 `@updateURL` / `@downloadURL` 已含 token，之后由油猴自动检查更新。token 不会被写入仓库任何文件。

> 提示：`npm run check` 的测试偶尔会因异步时序出现单次抖动（重跑即通过）；CI 若因个别用例偶发失败，可重新运行 workflow。

## 模块与分类

| 文件 | 职责 |
| --- | --- |
| `src/core/navigation.js` | 原生链接过渡、跨页恢复、超时和返回清理 |
| `src/core/settings.js` | 通用悬浮按钮、字体 / 字号 / 配色与设置面板 |
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

## 验证范围

通过 Node 语法检查、完整 DOM 回归测试，以及回复时间先于标题、置顶误判、设置持久化、恢复默认、视口改写、跳转恢复 / 超时 / 返回等专项测试。构建无需下载依赖；`npm ci` 的依赖只用于测试。

已完成远端桌面 Chrome + Tampermonkey 的真实页面、网页安装更新与源码自动刷新验证，过程见 [远端浏览器调试记录](docs/remote-browser-debugging.md)。尚未完成实际手机浏览器的视觉实测，DOM 回归测试不代表手机真机验证。

参考官方文档：[Tampermonkey](https://www.tampermonkey.net/documentation.php)、[Node 文件 API](https://nodejs.org/api/fs.html)。

## 油猴联调（本机或远端 Chrome）

浏览器可以运行在另一台机器；执行脚本的机器只需 Node 和能访问的 CDP 地址，不需要本机安装 Chrome 或 Tampermonkey。

```sh
# 检查远端浏览器是否就绪
scripts/dev-browser.sh http://192.168.101.165:9222
# 新开 NGA 页面、验证阅境并将截图保存到执行脚本的这台机器
CDP_URL=http://192.168.101.165:9222 node scripts/verify-tm.mjs
# 可指定页面和本机截图路径
CDP_URL=http://192.168.101.165:9222 node scripts/verify-tm.mjs 'https://bbs.nga.cn/thread.php?fid=-7' /tmp/readscape-tm-shot.png
```

远端 Chrome 的 Tampermonkey 中须安装并启用构建后的 `dist/readscape-nga.user.js`；本机文件不会自动出现在远端浏览器中。验证脚本使用真实油猴注入，不主动向页面注入源码；阅境未生效时也会保存截图，并以非零状态退出。验证结束保留新开的页面，方便继续检查。

`CDP_URL` 默认是 `http://localhost:9222`，也支持省略 `http://`。每次从 `/json/version` 和新建标签响应发现调试地址，不需要保存会变化的 WebSocket ID。连接时保留调试路径，并用配置的主机和端口替换 Chrome 返回的 WebSocket 主机和端口，支持跨机器连接以及 SSH 端口转发。例如先运行 `ssh -N -L 19222:127.0.0.1:9222 user@browser-host`，再设置 `CDP_URL=http://localhost:19222`。

无参数运行 `scripts/dev-browser.sh` 时，先检查本机端口；尚未运行才启动本机 Chrome for Testing。可用 `CFT`、`TM_EXT`、`PROFILE` 指定浏览器可执行文件、解压后的 Tampermonkey 扩展目录和独立 profile。显式指定 CDP 地址时只检查连接，连接失败不会尝试启动本机浏览器。

## 网页安装与开发自动刷新

```sh
npm run dev
# 多网卡、端口转发或自定义端口时，指定远端浏览器实际访问的地址
npm run dev -- --host 0.0.0.0 --port 5173 --origin http://192.168.101.105:5173
```

服务默认监听 `0.0.0.0:5173`，启动时打印局域网网页地址。浏览器与开发服务可以在不同机器上；浏览器需能访问开发机器的端口。`localhost` 指浏览器所在机器，因此远端安装应使用开发机器的 IP，或用 `--origin` / `DEV_ORIGIN` 指定可达地址。也支持 `DEV_HOST`、`DEV_PORT` 和 `--adapter nga`。

打开服务首页，点击“安装 / 更新开发脚本”，在 Tampermonkey 中确认安装，再打开 NGA 页面。这个开发脚本会通过 `GM_xmlhttpRequest` 加载当前构建，每隔约 1.5 秒检查版本；修改 `src/` 或 `package.json` 后自动重新构建，成功后刷新已打开的 NGA 页面。它是整页刷新，编辑中的回复可能丢失。构建失败时不刷新，终端显示错误；修正源码后继续更新。服务断开后当前已渲染页面保留，恢复服务后继续检查；开发脚本在新页面上需要服务在线。

`/__monkey.user.js` 是开发脚本安装链接，`/readscape-nga.user.js` 是正式脚本安装链接。两者沿用相同脚本名称和 namespace，安装时替换已有脚本；阅境的阅读设置、IndexedDB 收藏和缓存保留。开发完成后，从首页安装正式脚本即可脱离开发服务器。正式链接包含 `@updateURL` / `@downloadURL`，后续提高 `package.json` 版本并重新构建后，可以用油猴检查更新；也可以直接点击链接手动更新。同版本源码变动由开发脚本自动刷新处理。

这个流程复用现有 Node 构建器，没有增加 Vite 依赖；不是 Vite 的模块 HMR。浏览器安装和跨域开发请求采用 [Tampermonkey 的 Userscript 元数据与 API](https://www.tampermonkey.net/documentation.php)。正式 `npm run build` 产物依然是独立单文件，不包含开发加载器。
