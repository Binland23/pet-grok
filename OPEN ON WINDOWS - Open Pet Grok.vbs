' ============================================================
'  Pet Grok — Windows quiet launcher (backend + backup)
'  Windows users: prefer "OPEN ON WINDOWS - Open Pet Grok.lnk"
'  Mac users: use "OPEN ON MAC - Open Pet Grok.command" or Desktop Pet Grok.app
'  Port 7788 · service identity: pet-grok
'  Always: open Electron app window + keep consoles minimized.
' ============================================================
Option Explicit

Dim sh, fso, root, appDir, icoPath, vbsPath, lnkPath, sc
Dim nodeCmd, npmCmd, installNeeded, rc, healthUrl, showUrl, port, serviceId
Dim i, ready

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
appDir = root & "\app"
icoPath = appDir & "\icons\pet-grok-icon.ico"
If Not fso.FileExists(icoPath) Then icoPath = appDir & "\icons\play-pet-grok-icon.ico"
vbsPath = WScript.ScriptFullName
lnkPath = root & "\OPEN ON WINDOWS - Open Pet Grok.lnk"
port = 7788
serviceId = "pet-grok"
healthUrl = "http://127.0.0.1:" & port & "/api/health"
showUrl = "http://127.0.0.1:" & port & "/show"

' Refresh sibling .lnk with absolute paths + custom icon
On Error Resume Next
If fso.FileExists(icoPath) Then
  Set sc = sh.CreateShortcut(lnkPath)
  sc.TargetPath = "C:\Windows\System32\wscript.exe"
  sc.Arguments = "//nologo """ & vbsPath & """"
  sc.WorkingDirectory = root
  sc.WindowStyle = 7
  sc.Description = "Open Pet Grok (Windows)"
  sc.IconLocation = icoPath & ",0"
  sc.Save
End If
On Error GoTo 0

If IsOurs(healthUrl, serviceId) Then
  Call ShowExisting(showUrl)
  WScript.Quit 0
End If

If Not fso.FolderExists(appDir) Or Not fso.FileExists(appDir & "\package.json") Then
  MsgBox "Could not find the app folder next to this launcher." & vbCrLf & _
         "Keep the Windows launchers next to the app folder.", vbCritical, "Pet Grok"
  WScript.Quit 1
End If

sh.CurrentDirectory = appDir

' Resolve node / npm on PATH
nodeCmd = FindOnPath("node.exe")
If nodeCmd = "" Then nodeCmd = FindOnPath("node")
npmCmd = FindOnPath("npm.cmd")
If npmCmd = "" Then npmCmd = FindOnPath("npm")

If nodeCmd = "" Then
  MsgBox "Node.js is not on PATH." & vbCrLf & _
         "Install Node 18+ from https://nodejs.org then try again.", vbCritical, "Pet Grok"
  WScript.Quit 1
End If

If npmCmd = "" Then
  MsgBox "npm is not on PATH." & vbCrLf & _
         "Reinstall Node.js from https://nodejs.org", vbCritical, "Pet Grok"
  WScript.Quit 1
End If

installNeeded = Not fso.FolderExists(appDir & "\node_modules\electron")
If installNeeded Then
  ' Minimized console for install
  rc = sh.Run("cmd /c """ & npmCmd & """ install", 7, True)
  If rc <> 0 Then
    MsgBox "npm install failed (exit " & rc & ")." & vbCrLf & _
           "Open a terminal in the app folder and run: npm install", vbCritical, "Pet Grok"
    WScript.Quit 1
  End If
End If

' Bind Grok hooks (best-effort, quiet)
sh.Run "cmd /c """ & nodeCmd & """ -e ""try{require('./main/hooks').installHooks()}catch(e){}""", 0, True

' Start Electron minimized; Electron opens its own desktop window
sh.Run "cmd /c """ & npmCmd & """ start", 7, False

ready = False
For i = 1 To 60
  WScript.Sleep 200
  If IsOurs(healthUrl, serviceId) Then
    ready = True
    Exit For
  End If
Next

If Not ready Then
  ' Electron may still be starting; do not hard-fail if process was launched
  WScript.Quit 0
End If

WScript.Quit 0

Function IsOurs(u, sid)
  On Error Resume Next
  Dim xhr, body
  Set xhr = CreateObject("MSXML2.XMLHTTP")
  xhr.Open "GET", u, False
  xhr.Send
  body = ""
  If Err.Number = 0 And xhr.Status >= 200 And xhr.Status < 300 Then
    body = CStr(xhr.ResponseText)
  End If
  IsOurs = (InStr(1, body, """service""", vbTextCompare) > 0) And _
           (InStr(1, body, sid, vbTextCompare) > 0)
  On Error GoTo 0
End Function

Sub ShowExisting(u)
  On Error Resume Next
  Dim xhr
  Set xhr = CreateObject("MSXML2.XMLHTTP")
  xhr.Open "POST", u, False
  xhr.Send
  On Error GoTo 0
End Sub

Function FindOnPath(exeName)
  Dim result, parts, i, candidate, pathEnv
  FindOnPath = ""
  On Error Resume Next
  result = sh.ExpandEnvironmentStrings("%PATH%")
  pathEnv = result
  parts = Split(pathEnv, ";")
  For i = 0 To UBound(parts)
    If Len(parts(i)) > 0 Then
      candidate = parts(i)
      If Right(candidate, 1) <> "\" Then candidate = candidate & "\"
      candidate = candidate & exeName
      If fso.FileExists(candidate) Then
        FindOnPath = candidate
        Exit Function
      End If
    End If
  Next
  ' Also try common install locations
  Dim homes(3)
  homes(0) = sh.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\") & exeName
  homes(1) = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\nodejs\") & exeName
  homes(2) = sh.ExpandEnvironmentStrings("%LocalAppData%\Programs\nodejs\") & exeName
  homes(3) = sh.ExpandEnvironmentStrings("%APPDATA%\npm\") & exeName
  For i = 0 To 3
    If fso.FileExists(homes(i)) Then
      FindOnPath = homes(i)
      Exit Function
    End If
  Next
  On Error GoTo 0
End Function
