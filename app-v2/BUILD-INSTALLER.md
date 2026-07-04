# Instalador "para clicar" — Ultimate Sim App

## ✅ Já está construído (pronto para usar)

Gerado nesta máquina (Mac, cross-build) em `app-v2/dist-win/`:

| Arquivo | O quê |
|---|---|
| **`Ultimate Sim App-2.0.0-x64.exe`** (~105 MB) | **Instalador NSIS** — copie para um Windows x64 e dê **duplo-clique**. Wizard assistido (escolhe pasta, cria atalhos no Menu Iniciar e Desktop). Inclui **uninstaller** (Adicionar/Remover Programas) e **desinstala automaticamente uma versão anterior do v2** antes de instalar. |
| `Ultimate Sim App-2.0.0-x64.zip` (~148 MB) | **Portátil** — descompacte e rode `Ultimate Sim App.exe` (sem instalar). |

> ℹ️ **Instala lado a lado.** O app tem identidade própria (appId `io.github.ultimatesim.app`,
> dados em `%APPDATA%/ultimate-sim-app`) — **não toca** numa instalação atual do app antigo nem nos
> dados dela. Pode rodar os dois.

> ⚠️ **App não assinado:** na primeira execução o Windows SmartScreen mostra um aviso →
> *Mais informações → Executar assim mesmo*. (Para remover o aviso seria preciso um
> certificado de assinatura de código — opcional.)
>
> Embute o binário nativo `serialport`/`koffi` (win32-x64) e as pastas `driver/` (INF) e `firmware/`.

## Como instalar (2 cliques)
1. Copie `Ultimate Sim App-2.0.0-x64.exe` para o Windows.
2. Duplo-clique → (SmartScreen) *Mais informações → Executar assim mesmo* → siga o wizard.
3. Abra "Ultimate Sim App" pelo Menu Iniciar/atalho.

## Regerar o instalador
No Mac (makensis instalado) ou Windows, em `app-v2/`: `npm run build` e depois
`npx electron-builder --win nsis --x64` (e, se quiser o portátil, `npx electron-builder --win zip --x64`
em comando separado). Fallback sem Mac: workflow GitHub Actions Windows ou `npm run dist:win` no Windows.

Para **regerar** (ex.: após mudar a versão) ou buildar você mesmo, veja também as formas abaixo.

---

## 1) No Windows (mais simples e confiável)

Pré-requisitos: Node.js 20+ e Git.

```bat
git clone <este-repo>  &&  cd ultimate-sim-app\app-v2
npm ci
npm run dist:win
```

Saída: **`app-v2\dist-win\Ultimate Sim App-<versão>-x64.exe`** — é só clicar.
O `serialport` é recompilado automaticamente para Windows pelo electron-builder.

---

## 2) GitHub Actions (sem ter um PC Windows)

Já existe o workflow `.github/workflows/build-windows-installer.yml`.

1. Suba este projeto para um repositório no GitHub.
2. Aba **Actions → Build Windows Installer → Run workflow**.
3. Ao terminar, baixe o artefato **UltimateSimApp-Setup** (contém o `.exe`).
   - Dica: criar uma tag `v1.0.0` (`git tag v1.0.0 && git push --tags`) também anexa o `.exe`
     a uma **Release** do GitHub.

Um runner `windows-latest` builda o instalador nativo — caminho mais confiável.

---

## 3) No macOS (Apple Silicon/Intel) — SEM Wine

O electron-builder 26+ usa o **`makensis` nativo do Homebrew** (não precisa de Wine):

```bash
brew install makensis
cd app-v2
npm ci
npm run dist:win        # gera nsis (.exe) + zip, ambos x64
# ou, sobrepondo o target (especifique a arch!):
# npx electron-builder --win nsis --x64
```

Saída em `app-v2/dist-win/`. Foi exatamente assim que os artefatos acima foram gerados.
(O cask `wine-stable` NÃO é necessário — e no macOS atual ele é Intel-only/deprecado e a
dependência gstreamer exige `sudo`.)

---

## O que o instalador faz

- Instala o app **Ultimate ButtonBox** (atalhos na área de trabalho + menu Iniciar).
- Embute a pasta **`driver/`** (INF + guia) em `resources/driver/` — útil se você quiser dar
  nome próprio à porta COM (opcional; veja `driver/INSTALL.md`).
- Inclui o binário nativo `serialport` para Windows x64.
- O `appId` agora é estável (`io.github.ultimatesim.app`) e a `version` deve subir a cada release; isso permite que o NSIS detecte upgrades e remova instalações antigas de forma limpa.

> Lembre: a porta COM é exclusiva — configure com o **SimHub fechado**; ao correr, feche o app.
