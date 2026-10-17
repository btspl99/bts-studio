; BTS Studio — custom NSIS steps (included by electron-builder, see package.json "nsis.include").

; On a real uninstall (not an auto-update), remove the BTS Studio Virtual Camera from Windows if it was
; registered. Registration needs administrator rights, so Windows asks for permission once.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadRegStr $0 HKCR "CLSID\{2549D071-66AE-4F28-8116-6ABFE429F663}\InprocServer32" ""
    ${if} $0 != ""
      ExecShellWait "runas" "$SYSDIR\regsvr32.exe" '/u /s "$0"' SW_HIDE
    ${endIf}
  ${endIf}
!macroend
