# QA Report — ButtonBox Manager v3 (driver + software + firmware)

Escopo auditado: **firmware v3** (`firmware/buttonbox_v3/`), **app Electron** (`app/`),
**pacote driver/INF** (`driver/`) e **protocolo serial** (`docs/serial-protocol.md`).

## Metodologia (metodologia do projeto)

QA cross-model iterativo: **3 modelos em paralelo**, rotacionando entre rodadas, repetindo
até voltar **clean** (0 críticas/majors). Quando clean, uma **rodada final com Opus 4.8
(contexto 1M, esforço xhigh)**.

Evidências de build automatizado:
- Firmware compila (`arduino-cli compile --fqbn arduino:avr:leonardo`): **OK, 88% do flash**
  (25.450 / 28.672 bytes) — dentro do teto de 90%.
- App: `npm run typecheck` e `npm run build`: **OK**.

---

## Rodada 1 — modelos: Claude Opus 4.7 · GPT-5.5 · Gemini 3.1 Pro

Veredito consolidado: **ISSUES** (1 Critical, vários Major/Minor — alta concordância entre
modelos). Todos corrigidos.

| # | Sev | Onde | Problema | Correção |
|---|-----|------|----------|----------|
| 1 | **Critical** (Gemini; Major em Claude/GPT) | `buttonbox_v3.ino` encoders/switches | Ao remapear (`>MAP:`) no meio de um pulso/hold, o release ia para o botão HID **novo**, deixando o **antigo preso**. Também: mapeamentos **duplicados** se atrapalhavam no release. | Refcount `hidActive[18]` + **snapshot** do índice HID na pressão (`encPressedBtn[12]`, `swPressedBtn[6]`). `hidPress/hidRelease` só alteram o Joystick na transição 0↔1. |
| 2 | Major (Claude) / também Gemini | `app/src/main/serial-manager.ts` | App mantinha a porta COM **aberta** enquanto "conectado" → violava a spec §7 e impedia o SimHub de reusar a porta. Race de **resposta obsoleta** após timeout de 500ms. | Refator **stateless**: `withPort()` abre→envia→fecha em `finally`; `connect()` virou *probe* (`>ID?` e fecha). Sem handle persistente → elimina a race. |
| 3 | Major (GPT) / Minor (Claude) | `config_store.cpp` `configLoad` | Só `map[]` era validado; `pulse/debounce/encmode` podiam carregar valores inválidos com checksum válido (ex.: `pulse=0`). | Validação de range de `pulse`, `debounce` e `encmode` no load; senão restaura defaults. |
| 4 | Major (GPT) | `buttonbox_v3.ino` `handleCommand` | Comandos sem-argumento aceitavam `:args` (`>RESET:x` resetava). | Comandos sem-arg (ID?/PING/MAP?/CFG?/SAVE/LOAD/RESET) rejeitam args → `<ERR:bad_arg`. |
| 5 | Minor (Claude/GPT) | `cmdSetMap`/`cmdSetCfg` | `>MAP:`/`>CFG:` **vazios** respondiam `<OK`; `atoi` aceitava lixo (`e1cw=abc` virava `range`). | Exigir ≥1 campo (senão `bad_arg`); `strtol` com `endptr` → não-numérico = `bad_arg`, fora de faixa = `range`. |
| 6 | Minor (Gemini) | `loop()` | `Joystick.sendState()` chamado todo loop (~kHz) — spam de relatórios HID. | Flag `hidDirty`: só envia quando algum botão muda de estado. |
| 7 | Minor (GPT) | `driver/UltimateSimButtonBox.inf` | Faltava nota de assinatura no próprio INF. | Comentário sobre INF não assinado + ponteiro p/ seção de assinatura no `INSTALL.md` (que já cobria o tema). |

Partes **CLEAN** já na rodada 1: protocolo (fonte da verdade), parsing de comandos e
conversões 1-based↔0-based, layout/checksum/commit atômico da EEPROM, buffer 256 + `nomem`,
caminho de telemetria SimHub, segurança IPC (contextIsolation), wiring IPC, persistência de
perfis (path traversal bloqueado), e o INF (classe Ports, ClassGuid, usbser via mdmcpq).

---

## Rodada 2 — modelos: Claude Sonnet 4.6 · GPT-5.4 · Gemini 3.5 Flash

Foco: verificar correção/completude dos fixes da R1 e caçar **regressões** (leak/underflow
de refcount, handles de porta não fechados, relatórios HID perdidos).

**Firmware: R1 fixes verificados CORRETOS** pelos 3 modelos (refcount/snapshot sem
leak/underflow mesmo em giro rápido; `hidDirty` sem relatórios perdidos; validação de
EEPROM e `strtol`/ranges robustos). Protocolo firmware↔app: **match exato**.

Defeitos novos encontrados (todos corrigidos):

| # | Sev | Onde | Problema | Correção |
|---|-----|------|----------|----------|
| 8 | Minor (Claude) | `buttonbox_v3.ino` `processEncoders` | `millis()` retorna `0` no rollover (~49,7 dias); colidia com a sentinela `0` de `btnPressTime` → botão podia latchar HIGH. | Armar com `now ? now : 1` (nunca `0`). |
| 9 | **Major** (Claude+Gemini) | `app/.../serial-manager.ts` | Sem listener `'error'` na `SerialPort`: unplug USB no meio de um comando → evento `'error'` sem handler derruba o processo main do Electron. | Registrar `port.on('error', …)` encaminhando para `settle/reject` antes de `fn`. |
| 10 | Minor (Claude) | `app/.../serial-manager.ts` | Exceção no `closePort` dentro do `finally` mascarava o erro original. | `try/catch` ignorando erro de close no `finally`. |
| 11 | **Major** (GPT) | `app/.../profiles.ts` | Perfil carregado validava só presença de blocos → podia aplicar mapa parcial/misto. | Validação estrita: 18 eventos (1..18) + `pulse/debounce/encmode` antes de aplicar. |
| 12 | Minor (GPT) | `app/.../protocol.ts` | `parseInt` aceitava `1.9`/`18foo`. | Parsing inteiro estrito ao desserializar `<MAP:`/`<CFG:`. |
| 13 | Minor (GPT) | `app/.../index.ts` | App ainda se rotulava "V2". | Atualizado para v3. |
| 14 | **Major** (Gemini) | `driver/UltimateSimButtonBox.inf` | `CopyFiles=FakeModemCopyFileSection` (via `mdmcpq.inf`) desnecessário/duvidoso p/ usbser inbox. | INF minimal: removido `Include/CopyFiles/FakeModemCopyFileSection`; binding via `AddReg`+`AddService usbser` apenas. |

Firmware recompilado após o fix: **OK, 88% do flash** (25.482 bytes).

---

## Rodada 3 — modelos: Claude Opus 4.6 · GPT-5.5 · Gemini 3.1 Pro

Verificação dos fixes da R2 + regressões. **Opus 4.6 e Gemini 3.1 Pro: CLEAN.**
GPT-5.5 apontou 2 Minor (ambos corrigidos):

| # | Sev | Onde | Problema | Correção |
|---|-----|------|----------|----------|
| 15 | Minor (GPT) | `buttonbox_v3.ino` `processEncoders`/`releaseEncoderButtons` | O truque `now ? now : 1` ainda deixava um caso de borda: em `millis()==0` o release via `0 - 1` podia descartar 1 passo do encoder. | Substituída a sentinela `0` por um flag dedicado `btnArmed[12]`; `btnPressTime` volta a usar `now` puro. Sem colisão no rollover. |
| 16 | Minor (GPT) | `app/.../index.ts`, `renderer/index.html` | Título da janela/HTML não incluía "v3". | Títulos atualizados para "Ultimate Sim App v3". |

Firmware recompilado: **OK, 88%** (25.456 bytes). App `typecheck`+`build`: **OK**.

---

## Rodada 4 — modelos: Claude Opus 4.7 · GPT-5.4 · Gemini 3.5 Flash

Confirmação de clean-sweep (delta da R3 + regressão). **Os três: CLEAN.**
Verificado: refactor `btnArmed` correto (sem colisão de rollover, re-arm guard, snapshot e
refcount íntegros, release 1:1), títulos v3, e nenhum Critical/Major remanescente em
firmware, app e driver.

➡️ **Rodada de 3 modelos voltou CLEAN.**

---

## Rodada final — Opus 4.8 (contexto 1M, esforço xhigh)

Gate autoritativo: leitura holística end-to-end de todos os artefatos + **builds de
verificação executados** pelo revisor (app `typecheck`/`build` **PASS**; `arduino-cli
compile` **PASS**, 25.456 B / **88%**).

Veredito por domínio: **firmware · app+segurança · consistência de protocolo · driver INF ·
packaging · arquitetura — todos CLEAN.** Nenhum defeito Critical ou Major.

3 Minor (todos resolvidos):

| # | Sev | Onde | Defeito | Correção |
|---|-----|------|---------|----------|
| 17 | Minor | `README.md` | Dizia flash "85%"; real é 88%. | Atualizado para 88%. |
| 18 | Minor | `README.md` (seção legada v2) | Pinagem contradizia o firmware (SELECT `D2,D3`; SW `D14,D15`; pino de mux duplicado). | SELECT→`D5,D6,D14,D16`; SW→`…,A2,A3`; nota esclarecendo ligação por canais `C0–C11`. |
| 19 | Minor | `app` (hardening Electron) | Sem Content-Security-Policy. | CSP restritiva via `onHeadersReceived` no main (somente produção; dev/HMR intacto). |

**FINAL VERDICT: CLEAN — approved for sign-off** (após resolução dos 3 Minor).
App revalidado após a CSP: `typecheck`+`build` **OK**.

---

## Resumo

- **4 rodadas de 3 modelos** (rotacionados) + **1 rodada final Opus 4.8 (1M, xhigh)**.
- **19 achados** no total: 1 Critical, 6 Major, 12 Minor — **todos corrigidos**.
- Evidência final: firmware **88%** do flash (≤90%), app `typecheck`+`build` verdes.
