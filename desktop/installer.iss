#ifndef AppVersion
  #define AppVersion "0.1.1"
#endif
[Setup]
AppId={{F6D84621-B997-4634-85D1-8F3A172B4A6E}
AppName=B-roll Vault
AppVersion={#AppVersion}
AppPublisher=B-roll Vault
AppPublisherURL=https://github.com/PoyBoy96/Broll-vault
AppUpdatesURL=https://github.com/PoyBoy96/Broll-vault/releases
DefaultDirName={localappdata}\Programs\BrollVault
DefaultGroupName=B-roll Vault
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\output
OutputBaseFilename=BrollVaultSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
CloseApplicationsFilter=*.exe,*.dll,*.pyd
RestartApplications=no
UninstallDisplayIcon={app}\BrollVault.exe

[Files]
Source: "..\dist\BrollVault\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\B-roll Vault"; Filename: "{app}\BrollVault.exe"

[Run]
; Always relaunch after a normal install/update; no optional unchecked launch box.
Filename: "{app}\BrollVault.exe"; Flags: nowait skipifsilent; Description: "Open B-roll Vault"

; No uninstall deletion of settings, cache, catalogs, bins, or source media.
