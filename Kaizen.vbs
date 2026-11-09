' Opens Kaizen in its own window, starting the server first if needed.
Set sh = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
Set http = CreateObject("MSXML2.ServerXMLHTTP")
running = False
On Error Resume Next
http.Open "GET", "http://localhost:5177/api/ping", False
http.Send
If Err.Number = 0 And http.Status = 200 Then running = True
On Error GoTo 0
If Not running Then
  sh.Run "wscript """ & here & "\kaizen-server.vbs""", 0, False
  WScript.Sleep 1500
End If
sh.Run """C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"" --app=http://localhost:5177 --window-size=1280,860", 1, False
