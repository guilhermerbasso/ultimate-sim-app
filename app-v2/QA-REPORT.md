# QA Report — Sim Racing companion (app)

Escopo: os módulos novos (telemetria, OLED dashboard, overlays, combustível/estratégia,
lap timing, ações, alertas, gravação/análise, expressões, perfis de corrida, providers
iRacing/ACC/AC/AMS2). Build (typecheck + electron-vite) verde antes do QA.

## Metodologia
QA cross-model: 3 modelos em paralelo (Claude Opus 4.7 · GPT-5.5 · Gemini 3.1 Pro), foco em
defeitos reais de lógica/arquitetura/segurança/contrato. Depois, correção consolidada e
re-verificação de build. (Telemetria é Windows-only → validação real fica com o usuário.)

## Rodada 1 — achados consolidados (todos corrigidos)

### Critical
1. **iRacing MMF (koffi) — layout do `irsdk_header` errado**: faltava `int pad1[2]` antes de
   `varBuf` e cada `irsdk_varBuf` é 16 bytes (não 8) → leitura de telemetria lia lixo. (Claude)
2. **Broadcast iRacing — packing wParam/lParam invertido**: comandos (pit/câmera/replay/chat)
   seriam mal interpretados. Correção: `wParam=MAKELONG(cmd,var1)`, `lParam=var2`. (Claude)
3. **Hub `setSource('auto')` não parava o provider `mock`** (`if id==='mock' continue`) →
   mock seguia rodando em background. (Gemini)
4. **MMF sem bound-checking** em `numVars`/`sessionInfoLen` → travamento do processo se a
   memória estivesse corrompida/não-inicializada. (Gemini)

### Major
5. `telemetry:snapshot` emitido **2×** para overlays (broadcast global + `bindTelemetry`). (Claude)
6. Overlays usavam o **preload principal** (expunha `window.api` do ButtonBox) → preload mínimo. (Claude)
7. `hub.setSource` sem validar a fonte vinda do IPC. (GPT)
8. OLED engine iniciava o timer antes do sucesso da serial. (GPT/Claude)
9. Operações curtas durante o streaming do OLED fechavam/reabriam a porta (churn; risco de
   perturbar o CDC/HID) → **multiplex na sessão de streaming aberta**. (Claude/Gemini)
10. Recorder: rejeição na `writeQueue` matava a cadeia (parava de gravar em silêncio). (Claude)
11. `actions:trigger` (iRacing) era stub retornando `ok:true` → ligar ao `iracing-control`. (GPT/Claude)
12. Lap timing: último setor não finalizado no rollover → `optimalLap` nunca computava. (Claude)

### Minor (corrigidos os simples)
- `broadcast()` sem guardar `webContents.isDestroyed()`; prefixo `'sim:'` morto na allowlist;
  typo `LapLasNLapTime`; auto-resume do OLED comentado como intencional.

## Status
Correções aplicadas e re-verificadas no build (typecheck + electron-vite). Os pontos do
caminho iRacing/koffi **precisam de validação em pista no Windows** (offsets/enums reais).

## Rodada final — Opus 4.8 (1M, xhigh)

Revisão **empírica** (testou os tamanhos dos structs koffi 2.16.2): confirmou os fixes da
rodada 1 corretos (layout `irsdk_header`/`varBuf` 16B/`varHeader` 144B, enums, broadcast
packing, multiplex serial, recorder, ações, lap timing, overlays, segurança IPC/preload).

Achou **1 Critical** remanescente (corrigido):
- `irsdk-mmf.ts decodeAt/pointerAt` — a leitura por offset usava `koffi.as(endereço numérico)`
  que **sempre lança** → caía para o ponteiro base e lia **sempre o offset 0** (telemetria
  iRacing lia lixo apesar do layout certo). **Fix:** usar `koffi.decode(viewPointer, offset, type)`
  como via primária (offset nativo do koffi). Removido o `pointerAt` quebrado.
- Minor: bit de `greenWhiteCheckered` (0x400 era greenHeld) → zerado (irsdk não tem bit GWC direto).

Re-verificado: typecheck + build **verdes**. **Veredito: aprovado** (com a ressalva de
validação em pista no Windows para offsets/enums do iRacing).

---

# QA Report — iRacing telemetry fix + overlay fullscreen (2026-06-14)

Escopo: correção "telemetria do iRacing não aparece nem nos overlays nem nos dashboards" +
diagnóstico embutido + hardening de overlays em fullscreen. Mock já funcionava; SimHub lê o
iRacing no mesmo PC (prova de que o problema era o nosso leitor irsdk).

Arquivos: `src/main/iracing/irsdk-mmf.ts`, `provider.ts`, `src/shared/telemetry.ts`,
`src/main/modules/iracing-diagnostics.ts` (novo), `modules/index.ts`,
`src/renderer/src/lib/telemetry.ts`, `views/TelemetryView.tsx`, `src/main/overlays/manager.ts`, `README.md`.

## Causa-raiz
`isConnected()` decidia "conectado" via `WaitForSingleObject(0 ms)` no evento auto-reset
`IRSDKDataValidEvent` (quase sempre `WAIT_TIMEOUT`) → nunca conectado → `poll()` null → o hub
emitia null → "aguardando telemetria". Correção: usar o bit de status do header
(`irsdk_stConnected = 1`), como pyirsdk/node-irsdk/SimHub. Verificado contra a fonte do pyirsdk.

## Metodologia
Cross-model em paralelo, iterando até clean, depois revisão final única. Build (typecheck +
electron-vite) verde antes/depois de cada rodada.
- Rodada 1: Claude Opus 4.8 · GPT-5.4 · Gemini 3.1 Pro
- Rodada 2: Claude Opus 4.7 · GPT-5.5 · Gemini 3.1 Pro
- Final: Claude Opus 4.8 (long-context, xhigh)

## Rodada 1 — achados (todos corrigidos)
- **CRITICAL** (Gemini; confirmado empiricamente): `koffi.struct` lança "Duplicate type name"
  na 2ª registração. O módulo de diagnóstico cria um 2º `IRacingProvider` → `loadNativeLibraries()`
  re-registrava → null. Fix: cache module-scope (`cachedNative`/`nativeLoadAttempted`) — structs
  registrados uma única vez; provider + broadcast + diagnóstico compartilham. (Claude 4.8 NÃO pegou
  — valor do cross-model.)
- **HIGH** (Gemini): overlay `reassertTopmost` chamava `showInactive()` no `blur`, podendo
  derrubar/piscar jogos em fullscreen exclusivo. Fix: só `setAlwaysOnTop(true,'screen-saver')`.
- **MEDIUM** (Gemini): `isDataSignaled()` consumia o evento auto-reset (roubava frame de
  SimHub/CrewChief). Fix: removido `isDataSignaled()` + `WAIT_OBJECT_0` + campo `dataEventSignaled`.
- **MEDIUM** (GPT): `lastSnapshot` podia rebroadcast stale a cada read falho e não era limpo no
  `stop()`. Fix: guard de 1 tick (`reusedLastSnapshot`) + limpeza em `stop()`.

## Rodada 2 — re-verificação (clean nas mudanças)
- Claude 4.7: **clean**. GPT-5.5: **clean**. Gemini 3.1: 4 fixes verificados; 2 achados em código
  **PRÉ-EXISTENTE** não tocado (`control.ts` camera-switch; `readSessionInfoYaml` alloc) — fora de escopo.

## Final — Opus 4.8 (long-context, xhigh): ✅ SHIP
Sem Critical/High. Confirmou: semântica do status bit (sem falso-desconectado mid-session),
idempotência do cache koffi, guard de 1 tick, ciclo de vida do diagnóstico (finally/stop, graceful
fora do Windows), segurança do IPC, e ausência de regressão no overlay. Concordou que os 2 achados
do Gemini são fora de escopo (camera-switch = backlog; YAML = cacheado por `sessionInfoUpdate`, não-issue).

## Follow-up (backlog, fora desta entrega)
- `src/main/iracing/control.ts`: mapeamento de `carIdx` no camera-switch (`camSwitchNum`/`camSwitchPos`)
  — bug pré-existente do controle de câmera por button-box, sem relação com a telemetria.

## Artefatos
- `dist-win/Ultimate ButtonBox-0.2.0-x64.exe` (NSIS) · `dist-win/Ultimate ButtonBox-0.2.0-x64.zip`

---

# QA Report — Hardware Hub (Arduino estilo SimHub) (2026-06-14)

Escopo: novo menu **Hardware Hub** (config de dispositivos/componentes Arduino estilo SimHub),
engine de saída telemetria→companion v2 para Arduinos **genéricos/secundários**, e firmware
**iFlag 8×8** (matriz WS2812). Decisão de design: o Hub dirige só devices genéricos; o **SIM-X
primário permanece nas engines legadas** (Rev Lights/OLED) — sem duplo-comando.

Arquivos: `shared/devices.ts`, `shared/companion.ts` (protocolo v2 + brilho), `main/serial/device.ts`,
`main/devices/store.ts`, `main/modules/device-config.ts`, `main/devices/engines/render.ts`,
`main/modules/device-output.ts`, `main/modules/arduino.ts`, `main/modules/index.ts`,
`preload/index.ts`, `renderer/.../HardwareHubView.tsx` + `hub/*`, `firmware/companion-iflag/*`,
`docs/SIMHUB-ARDUINO-PARITY.md`.

## Metodologia
Cross-model em paralelo, iterando até clean, depois revisão final única. typecheck + electron-vite
build verde antes/depois de cada rodada.
- Rodada 1: Claude Opus 4.8 · GPT-5.4 · Gemini 3.1 Pro
- Rodada 2: Claude Opus 4.7 · GPT-5.5 · Gemini 3.1 Pro
- Final: Claude Opus 4.8 (long-context, xhigh)

## Rodada 1 — achados (corrigidos)
- **High**: o path de "Testar" ainda podia atingir o SIM-X (fallback ao primário). → `resolveDevice`
  recusa sim-x/primary; teste manda só frames companion.
- **High** (Gemini): orientação/serpentine da UI ignorados pelo engine. → rotação aplicada no JS
  (`rotateGrid`); serpentine fica no firmware (propriedade física).
- **Medium**: limite serial de 63 chars aplicado a devices genéricos (truncava fitas >10 LEDs,
  jogava fora linhas de matriz >8, "Testar" lançava erro). → `sendRaw` por tipo (sim-x 63 / genérico 200).
- **Medium**: normalização rasa → crash com JSON malformado/antigo. → `normalizeComponent` com defaults.
- **Medium**: dedup zerado a cada 2s (`updatedAt` re-carimbado). → preserva no load, bumpa no save,
  signature ignora timestamps.
- **Medium**: OLED secundário nascia inerte. → `useOledDashboard` default false.
- **Low**: brilho `Y` inerte. → `formatBrightness` + engine envia.

## Rodada 2 — achados (corrigidos)
- **High** (GPT): SIM-X podia ser persistido/reaberto como genérico, furando os guards. → guard no
  `arduino.ts addDevice` (não persiste o SIM-X/primary como genérico).
- **Medium** (GPT/Gemini): campos numéricos sem clamp; "Testar" de matrix podia estourar 200 chars. →
  `normalizeComponent` clampa ledCount/brightness/width/height/digits/orientation; teste de matrix
  clampa dims e envia brilho primeiro.
- **Low** (Claude): `revlights.updatedAt` aninhado ainda churnava o dedup. → signature recursiva
  (replacer dropa updatedAt/createdAt em qualquer nível).
- **Low** (Claude): buffer do firmware 96 < linhas largas. → `LINE_BUF_SIZE 96→220`.

## Final — Opus 4.8 (long-context, xhigh): ✅ SHIP
Sem Critical/High. Confirmou: o Hub (engine + teste) **nunca** dirige o SIM-X (guards por kind +
primaryId + guard no fleet; caso residual de adicionar a COM do SIM-X offline é benigno — o firmware
SIM-X ignora comandos companion e a porta é exclusiva, sem duplo-comando); engine sem leak/throw;
protocolo↔firmware exatos (Q/P/Y, buffer 200<220, rotação 90/180/270 correta); modelo de dados
robusto a JSON malformado; IPC seguro; sem regressões. 1 nit Low (hex de 3 dígitos) corrigido em
`clamp01Hex`.

## Artefatos
- `dist-win/Ultimate ButtonBox-0.2.0-x64.exe` (NSIS) · `dist-win/Ultimate ButtonBox-0.2.0-x64.zip`
- `firmware/companion-iflag/` (sketch + README) para gravar a matriz iFlag 8×8.

---

# QA Report — Arduino Setup Tool + Dashboards GT3 (2026-06-15)

Duas frentes novas: (A) **Arduino Setup Tool** (gravar firmware pronto dentro do app, estilo
SimHub "Open arduino setup tool") e (B) **Dashboards GT3** (17 widgets novos + 5 presets +
galeria). Guiadas por `docs/ARDUINO-SETUP-TOOL.md` e `docs/GT3-DASHBOARD-DESIGN.md`.

Arquivos A: `shared/setup.ts`, `main/devices/flasher.ts`, `main/modules/arduino-setup.ts`,
`main/devices/store.ts` (singleton), `device-config.ts`, `device-output.ts`, `modules/index.ts`,
`preload/index.ts`, `hub/SetupWizard.tsx`, `HardwareHubView.tsx`, `electron-builder.yml`,
`resources/tools/avrdude/win/*`, `resources/firmware/iflag-*.hex`, `firmware/prebuilt/*`.
Arquivos B: `shared/dashboards.ts`, `dashboard/DashboardRoot.tsx`, `dashboard/binding.ts`,
`dashboard/widgets/*`, `views/dashboard/widget-catalog.tsx`, `DashboardsView.tsx`, gt3-theme.

## Toolchain de firmware
arduino-cli 1.5.0 compilou o iFlag 8×8 para Nano (21% flash), Uno (20%), Pro Micro (29%); `.hex`
em `resources/firmware/`. avrdude (Windows) bundleado em `resources/tools/avrdude/win/`. O flasher
usa `spawn(argv)` (sem shell/injeção), trata Nano/Uno (`-c arduino`) e Pro Micro (`avr109` +
1200bps-touch + re-enumeração da porta de bootloader), com guard não-Windows.

## Metodologia
Cross-model em paralelo + revisão final. typecheck + build verdes antes/depois.
- Round 1: Claude Opus 4.8 · GPT-5.4 · Gemini 3.1 Pro
- Final: Claude Opus 4.8 (long-context, xhigh)

## Round 1 — achados (corrigidos)
- **Critical/High** (Gemini/GPT/Claude): `throttle/brake/clutch` em `DIRECT_KEYS` → `resolveBinding`
  nunca setava `pct` → barras de pedal vazias. → removidos do `DIRECT_KEYS` (bloco dedicado de pct roda).
- **High** (Gemini): `device-output` instanciava um `DeviceConfigStore` novo a cada 2s (risco de
  torn-read no `readFile`). → passa a usar `getDeviceConfigStore` singleton (estado em memória).
- **High** (GPT): verificação do Pro Micro reabria a porta original pós-flash (clones podem mudar a
  COM). → documentado como validação de hardware; flasher já re-detecta a porta de bootloader p/ gravar.
- **Medium** (GPT): guard SIM-X era só na UI. → `arduino-setup.flash()` rejeita porta `isSimX` no main.
- **Medium** (GPT): open/export usavam id velho ('') após auto-save. → `saveCurrent()` retorna o
  dashboard salvo; open/export usam o id retornado.
- **Medium** (Gemini): cancelar import SimHub podia crashar. → `try/catch` + guard de null.

## Final — Opus 4.8 (long-context, xhigh): ✅ SHIP
Sem Critical/High. 5 fixes verificados corretos/completos; flasher seguro (spawn argv, paths
packaged/dev, guard não-Windows, timeout/cleanup); Setup Tool nunca grava o SIM-X e o main nunca
crasha num flash falho; Dashboards retrocompatíveis com `dashboards.json` e widgets null-safe/baratos
por frame; sem regressões. Pendente: validação de hardware (flash real avrdude no Windows + Pro Micro
re-enumeração + handshake) — não bloqueia o instalador.

## Artefatos
- `dist-win/Ultimate ButtonBox-0.2.0-x64.exe` (NSIS) · `.zip`
- iFlag: `firmware/companion-iflag/` (fonte) + `.hex` pré-compilados gravados pelo Setup Tool.

## Adendo — módulo "Rev Lights (fita WS2812)" flashável (2026-06-15)
Tornado `available` no Setup Tool: firmware `firmware/companion-rgbstrip/` (FastLED, protocolo
companion P/L/R/B/Y/C/?), compilado p/ Nano (19% flash), Uno (18%), Pro Micro (27%), `.hex` em
`resources/firmware/rgbstrip-*.hex`. Agora o Setup Tool grava **iFlag 8×8** e **fita rev-lights**.

## Adendo — todos os módulos do Setup Tool (2026-06-15)
6 firmwares companion novos (OLED, char-LCD, 7-seg TM1638, gauge servo, buzzer, controls-HID),
compilados p/ as placas (flash 12–57%, <90%) e bundleados — **8 módulos `available`** no Setup Tool.
QA round 1 (Opus 4.8/GPT-5.4/Gemini 3.1): **Critical** (parser de capabilities exigia `=`, mas
buzzer/controls mandam `K:buzzer`/`K:control` → verificação falhava) corrigido relaxando o regex em
`parseCapabilityLine` (detail opcional, sem recompilar). +2 Medium: `capabilityDetail:'tm1638'` no
7-seg; encoder do controls passou a pulsar **por detente** (acumulador, 1 clique = 1 botão). Demais
firmwares "exceptionally clean" (serial guardado, sem delay bloqueante, libs corretas). typecheck verde.

## Adendo — 5 features novas: dash-cycle, soundshift, referência/comparação, insights, setups (2026-06-15)

Escopo: **F1** trocar dashboard por 1 botão (playlist + runtime global de ação), **F2** Soundshift
(beep de upshift Web Audio, por carro, auto-learn + lead preditivo), **F3/F4** voltas de referência +
comparação + coaching heurístico offline, **F5** auto-install de setups `.sto` (pasta local + URL https).
Fleet de 4 agentes (arquivos disjuntos) + integração central; typecheck + electron-vite build verdes.

### Metodologia
QA cross-model iterativo, **modelos rotacionados por rodada**, até 0 críticas; depois **QA final único
com Opus 4.8 (long-context, esforço xhigh)**. R1: Opus 4.8 · GPT-5.4 · Gemini 3.1. R2/R3: Opus 4.7 ·
GPT-5.5 · Gemini 3.1. Correções consolidadas e re-verificadas (typecheck+build) entre rodadas.

### Rodada 1 — achados (todos corrigidos)
- **[Critical] F5 OOM**: `fetchJsonManifest` lia o body inteiro antes de checar tamanho → leitura
  com cap por streaming (`readStreamBounded`) + guard de `Content-Length`.
- **[High] F5 SSRF**: `isBlockedAddress` não bloqueava `0.0.0.0`/`::` → adicionados (+ `100.64/10`).
- **[Medium]** download sem cap (→ `sizeCapStream` 50MB + unlink do parcial); race do watcher
  (seed do `autoSeen` antes do `watch()`); engine: `currentLapTimeSec` não-rebaseado, `totalLossSec`
  só top-8 (→ soma de todas as regiões), downsample perdia última amostra, closure stale no `scanIbt`;
  F2 `leadMs` morto e throttle de auto-learn global.

### Rodada 2 — achados (todos corrigidos)
- **[High] F5 SSRF (2)**: IPv4-mapped IPv6 (`::ffff:127.0.0.1`) não bloqueado; **DNS rebinding TOCTOU**
  (validava no `lookup`, refazia no `fetch`). → validação **no momento da conexão** via
  `node:https` + `validatingLookup` (rejeita se qualquer IP resolvido for privado) + normalização de
  IPv6 mapeado.
- **[High] F1 manager**: handler `'closed'` apagava `windows[id]` sem checar identidade → ao
  reabrir/ciclar dashboard em outro monitor, a janela antiga órfanizava a nova. → guard de identidade.
- **[Medium]** regressão do meu rebase de engine (perBinDelta[0]/buildOptimal) → revertido para
  rebase **somente no display** dos deltas; race de "evento perdido" no auto-install (→ pending re-run).

### Rodada 3 — achados (todos corrigidos)
- **[Critical] F5**: `validatingLookup` usava a forma de callback single; **Node ≥20 (Electron 42 =
  Node 22)** chama o `lookup` com `{all:true}` e exige a forma array → `ERR_INVALID_IP_ADDRESS`,
  quebrando **toda** busca por URL. **Reproduzido localmente** (Node 25): single → erro; honor-all →
  200. Corrigido honrando `options.all`; bloqueio SSRF revalidado (localhost/`::ffff:`/metadata
  rejeitados, públicos liberados).
- **[Medium]** pending re-run do auto-install podia rodar `source` obsoleto após troca de config →
  guard `config.autoInstallSourceId === source.id`.

### QA final — Opus 4.8 (long-context, xhigh): **SHIP**
Sem Critical/High remanescentes; todos os fixes coerentes entre si (nenhum desfeito por outro).
1 Medium não-bloqueante corrigido: no auto-install, `autoSeen.add` ocorria antes do `installSetup`
resolver → marca "seen" **somente após sucesso** (falha transitória é re-tentada no próximo evento).

### Limitação conhecida (documentada em FEATURES.md)
F1: a **execução** de comandos iRacing independe de foco, mas a **detecção do botão** usa a Web Gamepad
API (focus-gated). Mitigado com `backgroundThrottling:false` + poller na janela do dashboard; caminho
robusto futuro = leitura HID no processo main. **Validação em hardware/Windows fica com o usuário.**
