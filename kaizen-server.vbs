' Starts the Kaizen server hidden (used at login and by the Kaizen shortcut).
Set sh = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here & "\server"
sh.Run "cmd /c if not exist ""..\data"" mkdir ""..\data"" & node index.js >> ""..\data\server.log"" 2>&1", 0, False
