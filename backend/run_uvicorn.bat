@echo off
cd /d "%~dp0"
.\ecorouter\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
