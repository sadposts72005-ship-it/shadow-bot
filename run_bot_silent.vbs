Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\Shadow-Bot"
WshShell.Run "node.exe index.js", 0, False
