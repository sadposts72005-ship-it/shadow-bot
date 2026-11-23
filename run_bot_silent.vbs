Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\Shadow-Bot"
WshShell.Run "cmd.exe /c pm2 start shadow-bot || pm2 restart shadow-bot", 0, False
