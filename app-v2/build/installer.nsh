; Give the app's ordered before-quit teardown time to finish before the stock
; electron-builder process check can terminate it. This macro is non-destructive:
; the built-in _CHECK_APP_RUNNING still owns prompts and any final termination.
!include "getProcessInfo.nsh"
Var pid
Var /GLOBAL IsPowerShellAvailable

!macro customCheckAppRunning
  ${If} ${isUpdated}
    StrCpy $R8 0
    ${Do}
      !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
      ${If} $R0 != 0
        ${Break}
      ${EndIf}
      ${If} $R8 >= 15
        ${Break}
      ${EndIf}
      DetailPrint "Waiting for ${PRODUCT_NAME} to finish safe shutdown ($R8/15)..."
      Sleep 1000
      IntOp $R8 $R8 + 1
    ${Loop}
  ${EndIf}

  ; CHECK_APP_RUNNING initializes CmdPath/PowerShellPath before invoking this
  ; custom macro, but its stock PowerShell capability probe is bypassed.
  nsExec::Exec `"$PowerShellPath" -C "if ((Get-Command Get-CimInstance -ErrorAction SilentlyContinue) -and ((Get-ExecutionPolicy -Scope Process) -ne 'Restricted')) { exit 0 } else { exit 1 }"`
  Pop $0
  ${If} $0 == 0
    StrCpy $IsPowerShellAvailable 0
  ${Else}
    StrCpy $IsPowerShellAvailable 1
  ${EndIf}

  !insertmacro _CHECK_APP_RUNNING
!macroend
