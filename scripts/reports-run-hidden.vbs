' Reports agent (docs/reports-agent.md): Windows Task Scheduler starts this every 15 minutes. No window, so nothing comes up over the game.
Dim folder
folder = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """node"" """ & folder & "\reports-run.mjs"" run", 0, False
