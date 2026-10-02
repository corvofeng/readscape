# 开发指南

构建、测试、CI/CD、油猴联调与开发自动刷新的完整说明。使用者视角的安装与调试入口见 [README](../README.md)。

## Node 构建与测试

建议 Node 24 LTS，版本至少 24.15。构建只使用 Node 自带模块，测试使用 jsdom 和 fake-indexeddb。

```sh
npm ci
npm run check
npm run build -- nga
npm run list
```

`npm run build` 构建全部适配器，`npm run build -- nga` 只构建 NGA。产物位于本地 `dist/`，已由 `.gitignore` 排除；`main` 和源码版本标签的历史均不保存产物。`npm run build -- --fixed` 额外生成 `dist/v<package.json 版本>/` 的固定版。编辑 `src/` 后重新构建；不要修改产物，否则下次构建会覆盖。

## CI/CD 与油猴自动更新

GitHub Actions（`.github/workflows/ci-cd.yml`）负责持续集成与发布：

- **`verify`**：向 `main` 推送或提 PR 时运行 `npm ci && npm run check`（构建 + `node --check` 语法检查 + 全部测试），并把 `dist/*.user.js` 作为构建产物上传。
- **`publish`**：推送 `v*` 标签时（普通 `main` 推送只跑 verify，不更新 dist），在独立的 **`dist` 分支**追加提交，保留已有版本目录。根目录的 `readscape-<id>.user.js` 提供自动更新；`v<版本>/readscape-<id>.user.js` 提供固定安装。重新发布相同标签时只允许相同文件，内容不同则失败；补发旧标签不会把根目录脚本降级。标签必须与 `package.json` 和脚本版本一致。发布任务串行执行，通过普通推送保留产物历史。
- **Release**：新发布的 `v*` 标签额外创建 GitHub Release，附上**不含 token、禁用自动更新**的固定版脚本。原有 Release 附件保持原样，旧版的固定脚本可从 dist 版本目录安装。

构建器为每个脚本写入 `@updateURL` / `@downloadURL`（外加 `@homepageURL` / `@supportURL`），指向 `dist` 分支的 raw 地址：

```
https://raw.githubusercontent.com/corvofeng/readscape/dist/readscape-nga.user.js
```

油猴会定期比对 `@updateURL` 里的 `@version`，发现更高版本就从 `@downloadURL` 下载并替换脚本，从而实现自动更新。

固定版安装地址示例：`https://raw.githubusercontent.com/corvofeng/readscape/dist/v3.0.2/readscape-nga.user.js`。固定版将 `@updateURL` 和 `@downloadURL` 设为 `none`，禁用更新检查（见 [Tampermonkey 元数据说明](https://www.tampermonkey.net/documentation.php?q=update_url)）；需要升级时自行安装其他版本。后续发布不会改写已有版本目录。

### 安装（仓库公开后，零配置）

本项目会开源。仓库为 **public** 后，raw 地址无需任何凭证即可访问，上面的更新地址开箱即用：

```sh
# 打印各适配器的安装地址（也可加 -- nga 只看 NGA）
npm run install-url
```

把打印出的 raw 地址粘贴到浏览器即可触发油猴安装；之后提高 `package.json` 版本、提交并推送 `v*` 标签，CI 才会更新 `dist` 分支，油猴据此自动检查并安装新版本。也可在油猴里手动「检查更新」。

### 可选：私有期间用 token

在仓库转为 public 之前，它是 **private** 的，油猴检查更新不带凭证、访问私有 raw 地址会返回 404。经验证，把只读 token 内嵌到 URL 的 userinfo 即可拉取：

```
https://<TOKEN>@raw.githubusercontent.com/corvofeng/readscape/dist/readscape-nga.user.js
```

因为油猴更新后会用新脚本的元数据覆盖旧元数据，token 必须存在于**被下载的文件里**，而不能只写在 `main` 源码中。做法是：`main` 源码保持不含 token，CI 在发布时从 Actions Secret 注入 token，只写入 `dist` 分支的产物（已用一次性 dummy token 验证注入链路，验证后已清除）。若要在私有期间启用：

1. 在 GitHub 生成一个 **fine-grained Personal Access Token**，仅对本仓库授权、权限设为 **Contents: Read-only**（最小化泄露影响）。
2. 到仓库 `Settings → Secrets and variables → Actions` 新建 secret，名字为 `READSCAPE_UPDATE_TOKEN`，值为上面的 token。
3. 发布一个新版本标签，或在 Actions 里选择版本标签手动 `Run workflow`。此后 `dist` 分支根目录的脚本就带有 token，可自动更新；固定版本目录和 Release 附件不含 token。未配置该 secret 时，产物为不含 token 版本（正是公开仓库需要的形态）。

`npm run install-url` 默认打印纯公开 raw 安装地址。如需进行私有测试，可通过显式环境变量 `READSCAPE_UPDATE_TOKEN` 生成带 token 的地址；脚本不会主动读取本机 `gh` CLI 或系统凭证。

> 提示：`npm run check` 的测试偶尔会因异步时序出现单次抖动（重跑即通过）；CI 若因个别用例偶发失败，可重新运行 workflow。

## 验证范围

通过 Node 语法检查、完整 DOM 回归测试，以及回复时间先于标题、置顶误判、设置持久化、恢复默认、视口改写、跳转恢复 / 超时 / 返回等专项测试。构建无需下载依赖；`npm ci` 的依赖只用于测试。

已完成远端桌面 Chrome + Tampermonkey 的真实页面、网页安装更新与源码自动刷新验证，过程见 [远端浏览器调试记录](remote-browser-debugging.md)。尚未完成实际手机浏览器的视觉实测，DOM 回归测试不代表手机真机验证。

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

服务默认监听 `0.0.0.0:5173`，启动时打印局域网网页地址。浏览器与开发服务可以在不同机器；浏览器需能访问开发机器的端口。`localhost` 指浏览器所在机器，因此远端安装应使用开发机器的 IP，或用 `--origin` / `DEV_ORIGIN` 指定可达地址。也支持 `DEV_HOST`、`DEV_PORT` 和 `--adapter nga`。

打开服务首页，点击“安装 / 更新开发脚本”，在 Tampermonkey 中确认安装，再打开 NGA 页面。这个开发脚本会通过 `GM_xmlhttpRequest` 加载当前构建，每隔约 1.5 秒检查版本；修改 `src/` 或 `package.json` 后自动重新构建，成功后刷新已打开的 NGA 页面。它是整页刷新，编辑中的回复可能丢失。构建失败时不刷新，终端显示错误；修正源码后继续更新。服务断开后当前已渲染页面保留，恢复服务后继续检查；开发脚本在新页面上需要服务在线。

`/__monkey.user.js` 是开发脚本安装链接，`/readscape-nga.user.js` 是正式脚本安装链接。两者沿用相同脚本名称和 namespace，安装时替换已有脚本；阅境的阅读设置、IndexedDB 收藏和缓存保留。开发完成后，从首页安装正式脚本即可脱离开发服务器。正式链接包含 `@updateURL` / `@downloadURL`，后续提高 `package.json` 版本并重新构建后，可以用油猴检查更新；也可以直接点击链接手动更新。同版本源码变动由开发脚本自动刷新处理。

这个流程复用现有 Node 构建器，没有增加 Vite 依赖；不是 Vite 的模块 HMR。浏览器安装和跨域开发请求采用 [Tampermonkey 的 Userscript 元数据与 API](https://www.tampermonkey.net/documentation.php)。正式 `npm run build` 产物依然是独立单文件，不包含开发加载器。
