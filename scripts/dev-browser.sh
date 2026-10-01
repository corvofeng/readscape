#!/bin/bash
# 启动油猴调试浏览器（Chrome for Testing + Tampermonkey，独立 profile）
# 用法: scripts/dev-browser.sh
# 首次使用前的准备见 README「油猴联调」一节。
set -euo pipefail

CFT="/tmp/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
TM_EXT="/tmp/tampermonkey-ext"
PROFILE="/tmp/readscape-chrome-profile"

if [ ! -x "$CFT" ]; then
  echo "缺少 Chrome for Testing，先执行一次准备步骤（见 README）" >&2
  exit 1
fi

if curl -s --max-time 2 http://localhost:9222/json/version >/dev/null 2>&1; then
  echo "调试浏览器已在运行: http://localhost:9222"
  exit 0
fi

"$CFT" \
  --remote-debugging-port=9222 \
  --user-data-dir="$PROFILE" \
  --load-extension="$TM_EXT" \
  --no-first-run --no-default-browser-check \
  >/tmp/readscape-chrome.log 2>&1 &

sleep 3
curl -s --max-time 5 http://localhost:9222/json/version | head -3
echo "CDP 就绪: http://localhost:9222  (Tampermonkey 由 --load-extension 加载)"
