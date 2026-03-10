#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"
export HOMEBREW_MIRROR="${HOMEBREW_MIRROR:-cn}"
export NODE_MIRROR="${NODE_MIRROR:-cn}"
export NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
export FAST_START="${FAST_START:-on}"
cd "${SCRIPT_DIR}/.."

"${SCRIPT_DIR}/bootstrap-and-start.sh" --start-mode nohup

echo
echo "已完成。浏览器会自动打开 http://localhost:3000"
echo "如未自动打开，请手动访问。"
read -r -p "按回车键关闭窗口..." _
