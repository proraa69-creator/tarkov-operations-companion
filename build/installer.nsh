; The players' installer (RaidOSSetup.exe, electron-builder's assisted NSIS installer; package.json build.nsis.include).
; Owner, 03.11.2026: «когда выбираешь путь установки, в пути всегда в конце должна создаваться папка RaidOS».
; The uninstaller removes the whole install folder, so it is never a folder the player picked for other things.

!include LogicLib.nsh
!include FileFunc.nsh

; The default folder (C:\Program Files\RaidOS) and electron-builder's own check before the files go in
; (assistedInstaller.nsh instFilesPre: a path without this name gets it added) take this name.
!undef APP_FILENAME
!define APP_FILENAME "RaidOS"

; Right after «Выбор папки установки»: the chosen folder gets «RaidOS» at the end, unless it already is a RaidOS folder
; or the app is installed there (a new installer over a copy installed before keeps that copy's folder).
!macro customPageAfterChangeDir
  Page custom raidosInstallFolder

  Function raidosInstallFolder
    StrCpy $0 $INSTDIR 1 -1
    ${If} $0 == "\"
      StrCpy $INSTDIR $INSTDIR -1
    ${EndIf}
    ${GetFileName} $INSTDIR $0
    ${If} $0 != "RaidOS"
    ${AndIfNot} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
      StrCpy $INSTDIR "$INSTDIR\RaidOS"
    ${EndIf}
    Abort
  FunctionEnd
!macroend

; Security review, 03.11.2026: the app runs as administrator, so its own folder must not be writable by the player's other
; programs (a planted library or module would run with the rights). The installer is for all users (package.json
; perMachine) and Program Files is closed already; a folder picked elsewhere (D:\Games\RaidOS) inherits D:\'s rights,
; where every signed-in user may change files. Only administrators and the system may write there; users read and run.
!macro customInstall
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR" /inheritance:r /grant:r *S-1-5-32-544:(OI)(CI)F *S-1-5-18:(OI)(CI)F *S-1-5-32-545:(OI)(CI)RX /C /Q'
  Pop $0
!macroend
