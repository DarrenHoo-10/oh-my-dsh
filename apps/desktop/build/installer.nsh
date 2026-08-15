!macro customUnInstallCheck
  IfErrors uninstallLaunchFailed uninstallResultReady

  uninstallLaunchFailed:
    DetailPrint `Uninstall was not successful. Cleaning the recognized application payload directly.`
    Goto cleanupExistingHarness

  uninstallResultReady:
  ${if} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${endif}

  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" cleanupExistingHarness cleanupComplete

  cleanupExistingHarness:
    DetailPrint `Cleaning an existing DeepSeek Harness application payload.`
    Delete "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    Delete "$INSTDIR\*.dll"
    Delete "$INSTDIR\*.pak"
    Delete "$INSTDIR\*.bin"
    Delete "$INSTDIR\vk_swiftshader_icd.json"
    RMDir /r "$INSTDIR\locales"
    RMDir /r "$INSTDIR\resources"

  cleanupComplete:
!macroend
