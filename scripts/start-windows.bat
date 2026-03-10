@echo off
setlocal
set SCRIPT_DIR=%~dp0
set NODE_MIRROR=cn
set NPM_REGISTRY=https://registry.npmmirror.com
set FAST_START=on
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%bootstrap-and-start.ps1" -StartMode background -NodeMirror "%NODE_MIRROR%" -NpmRegistry "%NPM_REGISTRY%" -FastStart "%FAST_START%"
if %errorlevel% neq 0 (
  echo.
  echo 启动失败，请把窗口截图发给技术支持。
) else (
  echo.
  echo 启动完成，浏览器会自动打开 http://localhost:3000
)
pause
