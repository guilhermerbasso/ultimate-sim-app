# Ultimate Sim App

Aplicativo Electron para Windows: companion de sim racing (telemetria, overlays, dashboards, estratégia) e configuração do ButtonBox/iFlag (SIM-X). O app usa `electron-vite` + React + TypeScript, mantém o Electron seguro (`contextIsolation: true`, `nodeIntegration: false`) e conversa com o firmware via protocolo serial ASCII.

## Requisitos

- Node.js 20+ recomendado
- npm
- Windows 10/11 para gerar e validar o instalador NSIS final

## Desenvolvimento local

```bash
npm install
npm run dev
```

## Validação no Mac/Linux

```bash
npm run typecheck
npm run build
```

Isso valida TypeScript e bundles do Electron/renderer. **Não gere o instalador Windows no Mac.**

## Gerar instalador Windows / NSIS

Em uma máquina Windows:

```bash
npm install
npm run dist:win
```

O script executa `electron-vite build && electron-builder --win`. O `electron-builder.yml` está configurado para Windows NSIS x64.

### Nota sobre `serialport`

`serialport` usa módulos nativos. Ao gerar o instalador no Windows, o `electron-builder` deve fazer o rebuild nativo para o alvo Electron/Windows. O pacote fica fora do ASAR via `asarUnpack` para evitar empacotamento quebrado de módulos nativos.


### Overlays + fullscreen

Telemetry overlays can render over the sim only when the game runs in **Borderless** or **Windowed** mode, not exclusive Fullscreen. This is a Windows/DWM limitation shared by overlay tools such as SimHub.

## Driver INF

A pasta `../driver` é incluída como `extraResources` no instalador. Após instalar, os arquivos ficam em:

```text
resources/driver/
```

Consulte `resources/driver/INSTALL.md` para instalar o `UltimateSimButtonBox.inf`.

## Telas do app

1. **Dispositivos** — procurar portas COM, conectar/desconectar e exibir firmware/protocolo.
2. **Remapeamento** — editar 18 eventos físicos para botões HID 1–18 e ajustar config avançada.
3. **OLED / Telemetria** — enviar payloads de teste, limpar display e texto livre.
4. **Monitor de Inputs** — testar botões via Web Gamepad API; não usa serial.
5. **Perfis** — salvar, carregar, aplicar e excluir perfis locais em JSON.

## Porta serial exclusiva

Windows permite apenas um processo usando a COM por vez. Feche o SimHub antes de configurar o ButtonBox no app. Depois de configurar e salvar, desconecte no app para liberar a porta para o SimHub durante a corrida.
