#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3000}"
DATABASE_PATH="${DATABASE_PATH:-${APP_DIR}/fund-valuation.db}"
SERVICE_NAME="${SERVICE_NAME:-fund-valuation-demo}"
NODE_MAJOR="${NODE_MAJOR:-22}"
START_MODE="${START_MODE:-auto}"
HOMEBREW_MIRROR="${HOMEBREW_MIRROR:-cn}"
NODE_MIRROR="${NODE_MIRROR:-cn}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
FAST_START="${FAST_START:-on}"
SKIP_BUILD=0
RUNTIME_NODE_DIR="${APP_DIR}/.runtime/node"
NODE_DIST_BASE_URL_SELECTED=""

if [[ "$(id -u)" -eq 0 ]]; then
  RUN_USER="${RUN_USER:-${SUDO_USER:-root}}"
else
  RUN_USER="${RUN_USER:-$(id -un)}"
fi
RUN_GROUP="${RUN_GROUP:-$(id -gn "${RUN_USER}")}" 

log() {
  echo "[bootstrap] $*"
}

die() {
  echo "[bootstrap][error] $*" >&2
  exit 1
}

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Options:
  --port <port>               Service port (default: ${PORT})
  --database-path <path>      SQLite path (default: ${DATABASE_PATH})
  --service-name <name>       systemd service name (default: ${SERVICE_NAME})
  --node-major <version>      Node.js major version target (default: ${NODE_MAJOR})
  --start-mode <auto|systemd|nohup>
                              Startup strategy (default: ${START_MODE})
  --fast-start <on|off>       Skip install/build when unchanged (default: ${FAST_START})
  --skip-build                Skip npm run build
  -h, --help                  Show this help

Environment variables are also supported: PORT, DATABASE_PATH, SERVICE_NAME,
NODE_MAJOR, START_MODE, RUN_USER, RUN_GROUP, HOMEBREW_MIRROR, NODE_MIRROR, NPM_REGISTRY.
FAST_START=on|off controls whether install/build can be skipped when unchanged.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="$2"
      shift 2
      ;;
    --database-path)
      DATABASE_PATH="$2"
      shift 2
      ;;
    --service-name)
      SERVICE_NAME="$2"
      shift 2
      ;;
    --node-major)
      NODE_MAJOR="$2"
      shift 2
      ;;
    --start-mode)
      START_MODE="$2"
      shift 2
      ;;
    --fast-start)
      FAST_START="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

if [[ ! "${PORT}" =~ ^[0-9]+$ ]]; then
  die "Invalid --port: ${PORT}"
fi

if [[ "${START_MODE}" != "auto" && "${START_MODE}" != "systemd" && "${START_MODE}" != "nohup" ]]; then
  die "--start-mode must be one of auto|systemd|nohup"
fi

if [[ "${FAST_START}" != "on" && "${FAST_START}" != "off" ]]; then
  die "FAST_START must be on|off"
fi

run_as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

ensure_runtime_node_path() {
  if [[ -d "${RUNTIME_NODE_DIR}/bin" ]]; then
    prepend_path_if_dir "${RUNTIME_NODE_DIR}/bin"
  fi
}

node_dist_base_url() {
  case "${NODE_MIRROR}" in
    cn|china|npmmirror)
      echo "https://npmmirror.com/mirrors/node"
      ;;
    official|off|none)
      echo "https://nodejs.org/dist"
      ;;
    *)
      log "Unknown NODE_MIRROR=${NODE_MIRROR}, fallback to npmmirror"
      echo "https://npmmirror.com/mirrors/node"
      ;;
  esac
}

node_dist_fallback_base_url() {
  case "${NODE_MIRROR}" in
    cn|china|npmmirror)
      echo "https://nodejs.org/dist"
      ;;
    official|off|none)
      echo "https://npmmirror.com/mirrors/node"
      ;;
    *)
      echo "https://nodejs.org/dist"
      ;;
  esac
}

download_with_retry() {
  local url="$1"
  local output="$2"
  local attempts=0
  local max_attempts=5

  while [[ "${attempts}" -lt "${max_attempts}" ]]; do
    if curl -fL --connect-timeout 10 --retry 2 --retry-delay 2 "$url" -o "$output"; then
      return 0
    fi
    attempts=$((attempts + 1))
    log "Download failed (${attempts}/${max_attempts}), retry in 3s: ${url}"
    sleep 3
  done

  return 1
}

resolve_latest_node_version() {
  local base_url fallback_url
  base_url="$(node_dist_base_url)"
  fallback_url="$(node_dist_fallback_base_url)"
  local index_file
  index_file="$(mktemp /tmp/fund-node-index.XXXXXX)"
  local version=""
  local candidates=("${base_url}")
  if [[ "${fallback_url}" != "${base_url}" ]]; then
    candidates+=("${fallback_url}")
  fi

  local candidate
  for candidate in "${candidates[@]}"; do
    if download_with_retry "${candidate}/index.tab" "${index_file}"; then
      version="$(awk -F'\t' -v major="v${NODE_MAJOR}." 'NR>1 && index($1, major)==1 { print $1; exit }' "${index_file}")"
      if [[ -n "${version}" ]]; then
        NODE_DIST_BASE_URL_SELECTED="${candidate}"
        rm -f "${index_file}"
        echo "${version}"
        return 0
      fi
    fi
    log "Node index unavailable on ${candidate}, trying next source..."
  done

  rm -f "${index_file}"
  return 1
}

install_node_macos_pkg_fast() {
  local version
  if ! version="$(resolve_latest_node_version)"; then
    log "Could not resolve latest Node ${NODE_MAJOR}.x from mirror"
    return 1
  fi

  local base_url
  base_url="${NODE_DIST_BASE_URL_SELECTED:-$(node_dist_base_url)}"
  local pkg_url="${base_url}/${version}/node-${version}.pkg"
  local pkg_file="/tmp/node-${version}.pkg"

  log "Fast-installing Node.js ${version} via macOS pkg..."
  if ! download_with_retry "${pkg_url}" "${pkg_file}"; then
    log "Node pkg download failed: ${pkg_url}"
    return 1
  fi

  if ! run_as_root installer -pkg "${pkg_file}" -target / >/dev/null; then
    log "Node pkg installer failed"
    rm -f "${pkg_file}"
    return 1
  fi

  rm -f "${pkg_file}"
  ensure_macos_bin_paths
  hash -r
  command_exists node && command_exists npm
}

resolve_unix_node_dist_arch() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "${os}" in
    Darwin)
      case "${arch}" in
        arm64|aarch64)
          echo "darwin-arm64|tar.gz"
          ;;
        x86_64|amd64)
          echo "darwin-x64|tar.gz"
          ;;
        *)
          return 1
          ;;
      esac
      ;;
    Linux)
      case "${arch}" in
        x86_64|amd64)
          echo "linux-x64|tar.xz"
          ;;
        arm64|aarch64)
          echo "linux-arm64|tar.xz"
          ;;
        *)
          return 1
          ;;
      esac
      ;;
    *)
      return 1
      ;;
  esac
}

install_node_portable_unix() {
  local version dist_and_ext dist ext base_url archive_name archive_file extract_dir

  if ! version="$(resolve_latest_node_version)"; then
    log "Portable Node fallback: cannot resolve Node ${NODE_MAJOR}.x version from mirror"
    return 1
  fi

  if ! dist_and_ext="$(resolve_unix_node_dist_arch)"; then
    log "Portable Node fallback: unsupported OS/CPU ($(uname -s)/$(uname -m))"
    return 1
  fi

  dist="${dist_and_ext%|*}"
  ext="${dist_and_ext#*|}"
  base_url="${NODE_DIST_BASE_URL_SELECTED:-$(node_dist_base_url)}"
  archive_name="node-${version}-${dist}.${ext}"
  archive_file="/tmp/${archive_name}"
  extract_dir="${APP_DIR}/.runtime/node-${version}-${dist}"

  mkdir -p "${APP_DIR}/.runtime"
  log "Installing portable Node.js ${version} (${dist}) into project runtime..."
  if ! download_with_retry "${base_url}/${version}/${archive_name}" "${archive_file}"; then
    log "Portable Node download failed: ${base_url}/${version}/${archive_name}"
    return 1
  fi

  rm -rf "${extract_dir}" "${RUNTIME_NODE_DIR}"
  mkdir -p "${extract_dir}"
  if ! tar -xf "${archive_file}" -C "${extract_dir}" --strip-components=1; then
    rm -f "${archive_file}"
    rm -rf "${extract_dir}"
    log "Portable Node extract failed"
    return 1
  fi
  rm -f "${archive_file}"

  mv "${extract_dir}" "${RUNTIME_NODE_DIR}"
  ensure_runtime_node_path
  hash -r

  command_exists node && command_exists npm
}

install_npm_deps() {
  local action="$1"
  local install_ok=1

  if [[ -n "${NPM_REGISTRY}" ]]; then
    log "Installing npm dependencies via registry: ${NPM_REGISTRY}"
    if ! npm "${action}" --registry "${NPM_REGISTRY}"; then
      install_ok=0
    fi
  else
    install_ok=0
  fi

  if [[ "${install_ok}" -ne 1 ]]; then
    log "Retrying npm ${action} with default registry..."
    if ! npm "${action}"; then
      return 1
    fi
  fi

  return 0
}

is_any_file_newer_than() {
  local reference_file="$1"
  shift

  if [[ ! -f "${reference_file}" ]]; then
    return 0
  fi

  local path
  for path in "$@"; do
    if [[ -e "${path}" && "${path}" -nt "${reference_file}" ]]; then
      return 0
    fi
  done

  return 1
}

has_newer_sources_than() {
  local reference_file="$1"

  if [[ ! -f "${reference_file}" ]]; then
    return 0
  fi

  local hit
  hit="$(
    find "${APP_DIR}/app" "${APP_DIR}/components" "${APP_DIR}/lib" \
      -type f -newer "${reference_file}" -print -quit 2>/dev/null || true
  )"
  [[ -n "${hit}" ]]
}

reset_homebrew_mirror_env() {
  local vars=(
    HOMEBREW_ARTIFACT_DOMAIN
    HOMEBREW_API_DOMAIN
    HOMEBREW_BOTTLE_DOMAIN
  )

  local var
  for var in "${vars[@]}"; do
    if [[ -n "${!var:-}" ]]; then
      log "Detected ${var}, unsetting to avoid invalid mirror source"
      unset "${var}"
    fi
  done
}

configure_homebrew_mirror() {
  case "${HOMEBREW_MIRROR}" in
    cn|china|tuna)
      export HOMEBREW_API_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api"
      export HOMEBREW_BOTTLE_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles"
      export HOMEBREW_PIP_INDEX_URL="https://pypi.tuna.tsinghua.edu.cn/simple"
      log "Using China mirror (TUNA) for Homebrew bottles/API"
      ;;
    official|off|none)
      unset HOMEBREW_API_DOMAIN
      unset HOMEBREW_BOTTLE_DOMAIN
      unset HOMEBREW_PIP_INDEX_URL
      log "Using official Homebrew source"
      ;;
    *)
      log "Unknown HOMEBREW_MIRROR=${HOMEBREW_MIRROR}, fallback to China mirror (TUNA)"
      export HOMEBREW_API_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api"
      export HOMEBREW_BOTTLE_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles"
      export HOMEBREW_PIP_INDEX_URL="https://pypi.tuna.tsinghua.edu.cn/simple"
      ;;
  esac
}

prepend_path_if_dir() {
  local dir="$1"
  if [[ -d "${dir}" && ":${PATH}:" != *":${dir}:"* ]]; then
    export PATH="${dir}:${PATH}"
  fi
}

ensure_macos_bin_paths() {
  ensure_runtime_node_path
  prepend_path_if_dir /opt/homebrew/bin
  prepend_path_if_dir /usr/local/bin
  prepend_path_if_dir "/opt/homebrew/opt/node@${NODE_MAJOR}/bin"
  prepend_path_if_dir "/usr/local/opt/node@${NODE_MAJOR}/bin"
}

load_homebrew_shellenv() {
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    return
  fi

  if [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

brew_install_with_retry() {
  local formula="$1"
  local max_attempts=20
  local attempt=1
  local output

  while [[ "${attempt}" -le "${max_attempts}" ]]; do
    if output="$(brew install "${formula}" 2>&1)"; then
      return 0
    fi

    if grep -qi "has already locked" <<<"${output}"; then
      log "Homebrew is busy (formula=${formula}, attempt ${attempt}/${max_attempts}), retry in 10s..."
      sleep 10
      attempt=$((attempt + 1))
      continue
    fi

    echo "${output}" >&2
    return 1
  done

  die "Homebrew remains locked for too long (formula=${formula}). Please close other brew tasks and retry."
}

ensure_node_and_npm() {
  hash -r
  if command_exists node && command_exists npm; then
    return
  fi

  if command_exists brew; then
    local node_prefix
    node_prefix="$(brew --prefix "node@${NODE_MAJOR}" 2>/dev/null || true)"
    if [[ -n "${node_prefix}" && -d "${node_prefix}/bin" ]]; then
      prepend_path_if_dir "${node_prefix}/bin"
      hash -r
    fi
  fi

  command_exists node || die "node command not found after installation"
  command_exists npm || die "npm command not found after installation"
}

open_local_url() {
  local url="http://localhost:${PORT}"
  if command_exists open; then
    open "${url}" >/dev/null 2>&1 || true
  elif command_exists xdg-open; then
    xdg-open "${url}" >/dev/null 2>&1 || true
  fi
}

is_local_service_healthy() {
  command_exists curl && curl -fsS "http://localhost:${PORT}/api/v1/system/status" >/dev/null 2>&1
}

wait_for_local_server() {
  local attempts=0
  while [[ "${attempts}" -lt 25 ]]; do
    if command_exists curl && curl -fsS "http://localhost:${PORT}/api/v1/system/status" >/dev/null 2>&1; then
      log "Service is ready at http://localhost:${PORT}"
      open_local_url
      return
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  log "Service started, but readiness check timed out. Open http://localhost:${PORT} manually."
}

install_linux_packages() {
  if ! command_exists apt-get; then
    log "apt-get not found, skip Linux system package installation and use portable runtime fallback if needed"
    return
  fi

  local need_install=0
  local cmd
  for cmd in curl tar; do
    if ! command_exists "${cmd}"; then
      need_install=1
      break
    fi
  done

  if [[ "${need_install}" -eq 0 ]]; then
    log "Linux build dependencies detected, skip apt install"
    return
  fi

  log "Installing missing Linux runtime dependencies..."
  run_as_root apt-get update
  run_as_root apt-get install -y ca-certificates curl xz-utils tar
}

install_linux_build_tools() {
  if ! command_exists apt-get; then
    return 1
  fi
  log "Installing Linux build tools for native npm modules..."
  run_as_root apt-get update
  run_as_root apt-get install -y build-essential python3 make g++
}

install_node_linux() {
  local need_install=1

  ensure_runtime_node_path
  hash -r

  if command_exists node; then
    local current_major
    current_major="$(node -p "process.versions.node.split('.')[0]")"
    if [[ "${current_major}" -ge "${NODE_MAJOR}" ]]; then
      need_install=0
      log "Node.js ${current_major} detected, skip install"
    fi
  fi

  if [[ "${need_install}" -eq 1 ]]; then
    if command_exists apt-get; then
      log "Installing Node.js ${NODE_MAJOR}.x from NodeSource..."
      if curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | run_as_root -E bash - \
        && run_as_root apt-get install -y nodejs; then
        :
      else
        log "NodeSource install failed, trying portable Node fallback"
      fi
    fi
  fi

  if [[ "${need_install}" -eq 1 ]] && ! command_exists node; then
    if install_node_portable_unix; then
      log "Portable Node fallback installed"
    else
      die "Node.js install failed on Linux. Check network and retry."
    fi
  fi

  command_exists node || die "node install failed"
  command_exists npm || die "npm install failed"
}

install_macos_packages() {
  local node_ready=0
  local sqlite_ready=1

  ensure_macos_bin_paths
  hash -r

  if ! xcode-select -p >/dev/null 2>&1; then
    log "Installing Apple Command Line Tools (required for native npm packages)..."
    xcode-select --install || true
  fi

  if command_exists node; then
    local current_major
    current_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
    if [[ "${current_major}" -ge "${NODE_MAJOR}" ]]; then
      node_ready=1
      log "Node.js ${current_major} detected, skip install"
    fi
  fi

  if [[ "${node_ready}" -ne 1 ]]; then
    if install_node_macos_pkg_fast; then
      node_ready=1
      log "Node.js installed via pkg fast path"
    else
      log "Node pkg fast path failed, trying portable Node fallback"
      if install_node_portable_unix; then
        node_ready=1
        log "Node.js installed via portable runtime fallback"
      else
        log "Portable Node fallback failed, fallback to Homebrew"
      fi
    fi
  fi

  if [[ "${node_ready}" -eq 1 && "${sqlite_ready}" -eq 1 ]]; then
    ensure_macos_bin_paths
    ensure_node_and_npm
    return
  fi

  reset_homebrew_mirror_env
  configure_homebrew_mirror
  export HOMEBREW_NO_AUTO_UPDATE=1
  export HOMEBREW_NO_ENV_HINTS=1
  export HOMEBREW_NO_INSTALL_CLEANUP=1

  if ! command_exists brew; then
    log "Homebrew not found, installing..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi

  load_homebrew_shellenv
  ensure_macos_bin_paths
  hash -r

  log "Checking Homebrew packages (this may take 1-3 minutes on first run)..."
  if [[ "${node_ready}" -ne 1 ]]; then
    if ! brew list --versions "node@${NODE_MAJOR}" >/dev/null 2>&1; then
      log "Installing node@${NODE_MAJOR}..."
      if ! brew_install_with_retry "node@${NODE_MAJOR}"; then
        die "Homebrew install node@${NODE_MAJOR} failed. Please check network or Homebrew mirror settings."
      fi
    else
      log "node@${NODE_MAJOR} already installed"
    fi
  fi

  ensure_macos_bin_paths
  ensure_node_and_npm
}

install_runtime() {
  local os
  os="$(uname -s)"
  case "${os}" in
    Linux)
      install_linux_packages
      install_node_linux
      ;;
    Darwin)
      install_macos_packages
      ;;
    *)
      die "Unsupported OS: ${os}"
      ;;
  esac
}

install_app_dependencies() {
  log "Installing npm dependencies..."
  cd "${APP_DIR}"
  mkdir -p "${APP_DIR}/run"

  if ! command_exists npm; then
    if [[ "$(uname -s)" == "Darwin" ]]; then
      ensure_macos_bin_paths
      load_homebrew_shellenv
      ensure_node_and_npm
    else
      die "npm command not found"
    fi
  fi

  local deps_stamp="${APP_DIR}/run/deps.ready"
  local build_stamp="${APP_DIR}/run/build.ready"
  local deps_need_install=1

  if [[ "${FAST_START}" == "on" ]]; then
    if [[ -d "${APP_DIR}/node_modules" && -f "${deps_stamp}" ]]; then
      if ! is_any_file_newer_than "${deps_stamp}" "${APP_DIR}/package-lock.json" "${APP_DIR}/package.json"; then
        deps_need_install=0
      fi
    fi
  fi

  local install_ok=0
  if [[ "${deps_need_install}" -eq 0 ]]; then
    log "Dependencies unchanged, skip npm install"
    install_ok=1
  else
    if [[ -f package-lock.json ]]; then
      if install_npm_deps ci; then
        install_ok=1
      elif [[ "$(uname -s)" == "Linux" ]] && install_linux_build_tools && install_npm_deps ci; then
        install_ok=1
      fi
    else
      if install_npm_deps install; then
        install_ok=1
      elif [[ "$(uname -s)" == "Linux" ]] && install_linux_build_tools && install_npm_deps install; then
        install_ok=1
      fi
    fi
  fi

  if [[ "${install_ok}" -ne 1 ]]; then
    if [[ "$(uname -s)" == "Darwin" ]]; then
      die "npm install failed. If this is first run on macOS, complete Xcode Command Line Tools installation, then run this script again."
    fi
    die "npm install failed"
  fi

  if [[ "${deps_need_install}" -eq 1 ]]; then
    touch "${deps_stamp}"
  fi

  if [[ "${SKIP_BUILD}" -eq 0 ]]; then
    local build_need=1

    if [[ "${FAST_START}" == "on" ]]; then
      if [[ -f "${APP_DIR}/.next/BUILD_ID" && -f "${build_stamp}" ]]; then
        if ! is_any_file_newer_than "${build_stamp}" \
          "${APP_DIR}/package-lock.json" \
          "${APP_DIR}/package.json" \
          "${APP_DIR}/next.config.ts" \
          "${APP_DIR}/tsconfig.json"; then
          if ! has_newer_sources_than "${build_stamp}"; then
            build_need=0
          fi
        fi
      fi
    fi

    if [[ "${build_need}" -eq 0 ]]; then
      log "Build artifacts are fresh, skip npm run build"
    else
      log "Building Next.js app..."
      npm run build
      touch "${build_stamp}"
    fi
  fi
}

start_with_systemd() {
  command_exists systemctl || die "systemctl not found"

  local npm_bin
  npm_bin="$(command -v npm)"
  local unit_file="/etc/systemd/system/${SERVICE_NAME}.service"

  log "Creating systemd unit: ${unit_file}"
  run_as_root tee "${unit_file}" >/dev/null <<UNIT
[Unit]
Description=Fund Valuation Demo (Next.js)
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
User=${RUN_USER}
Group=${RUN_GROUP}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=DATABASE_PATH=${DATABASE_PATH}
Environment=TZ=Asia/Shanghai
ExecStart=${npm_bin} run start -- --port ${PORT}
Restart=always
RestartSec=5
KillSignal=SIGINT

[Install]
WantedBy=multi-user.target
UNIT

  run_as_root systemctl daemon-reload
  run_as_root systemctl enable --now "${SERVICE_NAME}"
  run_as_root systemctl restart "${SERVICE_NAME}"

  log "Service started with systemd"
  log "Check status: sudo systemctl status ${SERVICE_NAME}"
  log "View logs: sudo journalctl -u ${SERVICE_NAME} -f"
}

start_with_nohup() {
  log "Starting app with nohup fallback"
  cd "${APP_DIR}"
  mkdir -p run logs

  if [[ -f run/${SERVICE_NAME}.pid ]]; then
    local old_pid
    old_pid="$(cat run/${SERVICE_NAME}.pid || true)"
    if [[ -n "${old_pid}" ]] && kill -0 "${old_pid}" >/dev/null 2>&1; then
      kill "${old_pid}" || true
    fi
  fi

  NODE_ENV=production PORT="${PORT}" DATABASE_PATH="${DATABASE_PATH}" TZ=Asia/Shanghai \
    nohup npm run start -- --port "${PORT}" >"logs/${SERVICE_NAME}.log" 2>&1 &

  echo $! >"run/${SERVICE_NAME}.pid"
  log "App started. PID=$(cat run/${SERVICE_NAME}.pid)"
  log "Log file: ${APP_DIR}/logs/${SERVICE_NAME}.log"
  wait_for_local_server
}

choose_start_mode() {
  if [[ "${START_MODE}" == "systemd" ]]; then
    start_with_systemd
    return
  fi

  if [[ "${START_MODE}" == "nohup" ]]; then
    start_with_nohup
    return
  fi

  if command_exists systemctl && [[ "$(uname -s)" == "Linux" ]]; then
    start_with_systemd
  else
    start_with_nohup
  fi
}

log "App directory: ${APP_DIR}"
log "Database path: ${DATABASE_PATH}"
log "Port: ${PORT}"

if [[ "${FAST_START}" == "on" ]] && is_local_service_healthy; then
  log "Service already running and healthy, skip bootstrap"
  open_local_url
  log "Done."
  exit 0
fi

install_runtime
install_app_dependencies
choose_start_mode

log "Done."
