# Ultimate ButtonBox — Sim Racing companion (estilo SimHub)

Além de gerenciar o ButtonBox, o app virou um **companion de sim racing**: lê telemetria
do sim **direto** (sem SimHub) e a usa para OLED, overlays, estratégia, alertas, ações e análise.

> ⚠️ **Telemetria é Windows-only.** Os sims (iRacing/ACC/AC/AMS2) só existem no Windows.
> No Mac (ou sem sessão), use a fonte **Demo (mock)** para visualizar/configurar tudo.
> A leitura real (koffi/MMF, shared memory) precisa de **validação no Windows**.

## Telas (menu lateral)

**Sim Racing**
- **Telemetria** — escolhe a fonte (Off / Auto / Demo(mock) / iRacing / ACC / AC / AMS2) e mostra a visão geral ao vivo.
- **OLED Dashboard** — **presets selecionáveis sem código** (Corrida, Combustível, Tempos/Delta, Pneus, Inputs, Clima) que rotacionam no OLED do ButtonBox; com preview 128×64.
- **Overlays** — janelas transparentes sobre o jogo: rev/shift lights, gear+speed, delta, inputs, combustível, relativo/standings multiclass, bandeiras, pneus/freios, clima. Ligar/desligar, travar e posicionar.
- **Combustível** — uso/volta, voltas/combustível até o fim, fuel-save target, janela de pit, stint planner.
- **Análise** — grava telemetria e plota voltas (speed/throttle/brake/delta); **voltas de referência** (sua melhor volta + importar `.ibt`/CSV), **comparação de sessões/voltas** e **coaching heurístico offline** (dicas priorizadas por perda de tempo, por setor).
- **Ações** — liga botões do ButtonBox a comandos do **iRacing** (pit/câmera/replay via SDK broadcast), trocar página do OLED, ligar/desligar overlay e **trocar de dashboard (playlist) com 1 botão**. Macro de teclado é interface pronta (requer dep futura `@nut-tree/nut-js`).
  > ⚠️ A **execução** dos comandos iRacing independe de foco (SDK broadcast). Já a **detecção do botão** usa a Web Gamepad API, que só atualiza com a janela do app (ou do dashboard) em foco/visível. Para o jogo em tela cheia, validar no Windows; caminho robusto futuro: leitura HID no processo main.
- **Alertas** — pit limiter, bandeiras, combustível baixo, ponto de troca, limite de incidentes; com beep (Web Audio).
- **Expressões** — campos/condições customizadas com um avaliador próprio (sem `eval`, compatível com a CSP).
- **Perfis Corrida** — perfis por carro/pista (mapa HID + OLED + overlays + alertas + bindings) com sugestão de auto-troca.
- **Soundshift** — beep de troca de marcha no ponto ótimo (Web Audio, áudio do PC), **ajuste por carro** e **auto-aprendizado** do RPM de troca por marcha (com lead preditivo).
- **Setups** — auto-instalação de setups `.sto` a partir de **pasta local** ou **URL https** para `Documents/iRacing/setups/<carro>/` (Windows; validação https-only + anti-traversal).
- **Steward Desk** — casos locais com identidades/roles estáveis e inteiramente definidos no processo main; labels do renderer nunca controlam autoria. Clips são selados por integridade do SO, persistidos atomicamente e vinculados a uma geração imutável da sessão de captura, inclusive para ACC/AC/AMS2/LMU sem id nativo. Pacotes v2 carregam a chain canônica verificada; atores/vereditos importados viram claims não confiáveis que exigem nova decisão local, enquanto anonimização por schema allowlist e gates de direitos de terceiros permanecem obrigatórios. A chain continua **unanchored** sem âncora externa; o app nunca aplica penalidade automática.
- **Ensaio de Missão** — cria/importa manifestos versionados com papéis, permissões, checkpoints ramificados, eventos sintéticos determinísticos, decisões/resultados esperados, retomada, comparação entre repetições e debrief pontuado sem culpa. Funciona **100% offline** em namespace próprio, com marca-d’água de treinamento e reset que nunca toca telemetria ou histórico ao vivo.

**ButtonBox** — Dispositivos, Remapeamento, OLED manual, Monitor de Inputs, Perfis (o que já existia).

**App** — Configurações: auto-start com Windows, fonte de telemetria padrão, abrir pastas de dados/gravações.

## Diferenciais vs SimHub (para iRacing)

- **Controle nativo do iRacing** (pit/câmera/replay) pelos botões via SDK broadcast — algo que o SimHub não faz bem. A **execução** independe do foco da janela; a **detecção do botão** usa a Web Gamepad API (requer a janela do app/dashboard em foco/visível — caminho robusto futuro: HID no processo main).
- Dados iRacing-específicos: **incidentes + limite**, **fast repairs**, **wetness/chuva**, **multiclass** (cores/gap por classe), **SoF**.
- App focado e leve; **modo demo (mock)** para configurar fora de pista; protocolo serial bidirecional próprio.

## Arquitetura (para manutenção)

- **TelemetryHub** (`src/main/telemetry/hub.ts`) emite `snapshot` (modelo `src/shared/telemetry.ts`).
- Cada feature é um **módulo** em `src/main/modules/<id>.ts` (registrado em `modules/index.ts`) que recebe `ModuleContext` (hub, serial, broadcast, ipcMain) — registra IPC com prefixo próprio.
- Renderer usa `window.ipc` (ponte genérica com allowlist no preload) + `lib/telemetry.ts`; telas no `views/registry.tsx`.
- Providers nativos (`src/main/iracing/**`, `src/main/sims/**`) usam **koffi** (FFI, com prebuilds) — degradam graciosamente fora do Windows.

## Dependências nativas

- **koffi** (FFI, prebuilds p/ todas as plataformas — bundla a partir do Mac) → leitura de MMF/shared memory.
- **yaml** (puro JS) → parsing do session string do iRacing.
- (futuro) **@nut-tree/nut-js** → macros de teclado reais.

## Validação real (Windows) — checklist

1. Instalar o app no Windows (instalador já desinstala a versão anterior).
2. Abrir o sim; em **Telemetria**, escolher **Auto** ou **iRacing/ACC/AC/AMS2** e ver os dados.
3. Conferir OLED dashboard no ButtonBox, overlays na tela, combustível, e um comando de pit pelo botão (iRacing).
4. Reportar qualquer offset/valor errado (a leitura koffi/MMF foi escrita sem teste em pista).
