; build/installer.nsh — incluído automaticamente pelo electron-builder.
; Remove instalações anteriores antes de instalar a nova versão.

!macro UninstallExistingInstall ROOT_KEY APP_KEY DISPLAY_NAME
  ; 1) Ler o desinstalador e a pasta instalada para esta chave de uninstall.
  StrCpy $R2 "Software\Micro"
  StrCpy $R2 "$R2soft\Windows\CurrentVersion\Uninstall\${APP_KEY}"
  ReadRegStr $R0 ${ROOT_KEY} "$R2" "UninstallString"
  ReadRegStr $R1 ${ROOT_KEY} "$R2" "InstallLocation"

  ${If} $R0 != ""
    DetailPrint "Instalação anterior encontrada (${DISPLAY_NAME})."

    ; 2) Exigir InstallLocation para manter o uninstall síncrono via _?=<InstallLocation>.
    ${If} $R1 != ""
      ; 3) Copiar o uninstaller para $TEMP evita falha de auto-cópia/uninstall in-place.
      Delete "$TEMP\unins.exe"
      CopyFiles /SILENT $R0 "$TEMP\unins.exe"

      ; 4) Rodar silenciosamente e de forma síncrona, apontando para a pasta original.
      ${If} ${FileExists} "$TEMP\unins.exe"
        DetailPrint "Desinstalando versão anterior em $R1..."
        ExecWait '"$TEMP\unins.exe" /S _?=$R1' $0
        Delete "$TEMP\unins.exe"
      ${Else}
        ; 5) Fallback: se CopyFiles falhar, ainda tenta executar o UninstallString original.
        DetailPrint "Não foi possível copiar o uninstaller; tentando UninstallString original."
        ExecWait '$R0 /S _?=$R1' $0
      ${EndIf}

      ; 6) Remover a pasta remanescente caso o desinstalador deixe arquivos para trás.
      ${If} ${FileExists} "$R1\*.*"
        RMDir /r "$R1"
      ${EndIf}
    ${Else}
      ; 7) Sem InstallLocation, executar o UninstallString silencioso como melhor esforço.
      DetailPrint "InstallLocation ausente; desinstalando versão anterior por UninstallString."
      ExecWait '$R0 /S' $0
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  ; Auto-uninstall a previous "Ultimate Sim App" install (keyed by THIS build's appId).
  ; Side-by-side: intentionally does NOT touch any other app (no legacy ButtonBox/iFlag uninstall).
  !insertmacro UninstallExistingInstall SHCTX "${UNINSTALL_APP_KEY}" "Ultimate Sim App (SHCTX)"
  !insertmacro UninstallExistingInstall HKLM "${UNINSTALL_APP_KEY}" "Ultimate Sim App (HKLM)"
  !insertmacro UninstallExistingInstall HKCU "${UNINSTALL_APP_KEY}" "Ultimate Sim App (HKCU)"
!macroend
