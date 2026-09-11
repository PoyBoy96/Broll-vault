@echo off
setlocal
cd /d "%~dp0"
python broll_catalog_backend/server_api.py
endlocal
