@echo off
rem Rebuilds the phone app (only needed for native changes; screen changes update automatically).
rem Needs JDK 21 and the Android SDK. Set JAVA_HOME and ANDROID_HOME first if they aren't found below.
set "ROOT=%~dp0"
cd /d "%ROOT%mobile"
call npm run build || exit /b 1
if not defined JAVA_HOME for /d %%J in ("C:\Program Files\Microsoft\jdk-21*") do set "JAVA_HOME=%%~fJ"
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
call "%ROOT%mobile\android\gradlew.bat" -p "%ROOT%mobile\android" assembleDebug --no-daemon -q || exit /b 1
if not exist "%ROOT%data" mkdir "%ROOT%data"
copy /Y "%ROOT%mobile\android\app\build\outputs\apk\debug\app-debug.apk" "%ROOT%data\kaizen.apk" >nul
echo Built %ROOT%data\kaizen.apk
