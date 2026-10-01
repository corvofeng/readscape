#!/bin/bash
# 启动油猴调试浏览器（Chrome for Testing + Tampermonkey，独立 profile）
# 用法: scripts/dev-browser.sh [http://主机:9222]，或设置 CDP_URL
# 首次使用前的准备见 docs/development.md「油猴联调」一节。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXPLICIT_CDP="${1:-${CDP_URL:-}}"
CDP="$(node --input-type=module - "$SCRIPT_DIR/cdp.mjs" "${EXPLICIT_CDP:-http://localhost:9222}" <<'JS'
const { normalizeEndpoint } = await import(process.argv[2]);
console.log(normalizeEndpoint(process.argv[3]));
JS
)"

# 显式指定地址时只连接已有浏览器，包括 SSH 转发到本地的端口。
if curl -fsS --connect-timeout 2 --max-time 5 "$CDP/json/version" >/dev/null 2>&1; then
  echo "调试浏览器已就绪: $CDP"
  echo "验证: CDP_URL=$CDP node scripts/verify-tm.mjs"
  exit 0
fi
if [ -n "$EXPLICIT_CDP" ]; then
  echo "无法访问调试浏览器: ${CDP}；请检查远端 Chrome、网络及端口转发。" >&2
  exit 1
fi

CFT="${CFT:-/tmp/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing}"
TM_EXT="${TM_EXT:-/tmp/tampermonkey-ext}"
PROFILE="${PROFILE:-/tmp/readscape-chrome-profile}"

if [ ! -x "$CFT" ]; then
  echo "缺少 Chrome for Testing；通过 CFT 指定可执行文件，或通过 CDP_URL 连接已有浏览器。" >&2
  exit 1
fi
if [ ! -d "$TM_EXT" ]; then
  echo "缺少 Tampermonkey 解压目录，请通过 TM_EXT 指定。" >&2
  exit 1
fi

"$CFT" \
  --remote-debugging-port=9222 \
  --user-data-dir="$PROFILE" \
  --load-extension="$TM_EXT" \
  --no-first-run --no-default-browser-check \
  >/tmp/readscape-chrome.log 2>&1 &

for attempt in {1..15}; do
  if curl -fsS --connect-timeout 1 --max-time 2 "$CDP/json/version" >/dev/null 2>&1; then
    echo "CDP 就绪: $CDP (Tampermonkey 由 --load-extension 加载)"
    exit 0
  fi
  sleep 1
done
echo "Chrome 启动后未就绪，请查看 /tmp/readscape-chrome.log" >&2
exit 1
