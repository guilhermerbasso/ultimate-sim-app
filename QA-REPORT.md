# QA Report — Button Box V2 (P2.3)

**Projeto:** P2.3 — Button Box V2 (Encoders + OLED)  
**Data:** 2025  
**Autor do review:** QA iterativo (claude-opus-4.7 / gpt-5.5 / gemini-3.1-pro-preview)  
**Status final:** ✅ **APROVADO** (0 bugs críticos após R2)

---

## Resumo Executivo

| Métrica | R1 | R2 |
|---------|----|----|
| Bugs 🔴 críticos | 1 | 0 |
| Avisos 🟡 | 3 | 2 (não-críticos) |
| Status geral | 🟡 Fix necessário | ✅ Aprovado |

---

## Rodada R1 — claude-opus-4.7 + gpt-5.5 + gemini-3.1-pro-preview

### Achados

#### 🔴 BUG CRÍTICO — delay() bloqueante em processEncoders()

**Arquivo:** `firmware/buttonbox_v2.ino`  
**Linha:** ~245 (versão original)  
**Descrição:**  
```cpp
// CÓDIGO ORIGINAL (BUG)
Joystick.setButton(btnBase, HIGH);
delay(BUTTON_PULSE_MS);  // ← 80ms bloqueante!
Joystick.setButton(btnBase, LOW);
```

**Problema:** O `delay(80)` dentro do loop `processEncoders()` bloqueia **todo o microcontrolador** por 80ms. Durante esse tempo, os demais 5 encoders não são lidos. Um usuário que gira dois encoders simultaneamente (ex: BB e TC ao mesmo tempo) perderia steps do segundo encoder.

**Impacto:** Perda de passos de encoder em uso simultâneo de múltiplos encoders.

**Fix aplicado (R2):**
```cpp
// CÓDIGO CORRIGIDO — non-blocking millis() timer
uint32_t btnPressTime[NUM_ENCODERS * 2];   // timestamps de cada botão pressionado

// Em processEncoders():
Joystick.setButton(btnBase, HIGH);
btnPressTime[btnBase] = millis();  // Apenas registra o tempo

// Nova função releaseEncoderButtons() no loop:
void releaseEncoderButtons() {
  uint32_t now = millis();
  for (int i = 0; i < NUM_ENCODERS * 2; i++) {
    if (btnPressTime[i] > 0 && (now - btnPressTime[i]) >= BUTTON_PULSE_MS) {
      Joystick.setButton(i, LOW);
      btnPressTime[i] = 0;
    }
  }
}
```

**Status:** ✅ Corrigido em R2.

---

#### 🟡 AVISO 1 — Comentário incorreto D14 vs A0

**Arquivo:** `firmware/buttonbox_v2.ino`  
**Linha:** define MUX_S2  
**Descrição:**  
```cpp
// ORIGINAL (comentário incorreto)
#define MUX_S2   14   // A0 no Pro Micro = pino digital 18, usamos como D14
```
No Arduino Pro Micro ATmega32U4, `A0` e `D14` são **pinos físicos diferentes**:
- `A0` = pin 18 (ADC pino F0) — usado como `MUX_SIG`
- `D14` = pin 14 (MISO do SPI) — usado como `MUX_S2`

Não há conflito funcional, mas o comentário era enganoso.

**Fix:**
```cpp
#define MUX_S2   14   // D14 = MISO/SPI no Pro Micro — funciona como GPIO digital quando SPI inativo
```

**Status:** ✅ Corrigido em R2.

---

#### 🟡 AVISO 2 — BOM descreve CD74HC4067 como DIP16/SOIC16

**Arquivo:** `BOM.csv`  
**Descrição:** O CD74HC4067 é um mux de **16 canais** em pacote **DIP24 ou SOIC24** (24 pinos), não DIP16. Um DIP16 comporta apenas 8 canais (seria o CD74HC4051).

**Fix:** BOM atualizado para: `"⚠️ Pacote DIP24/SOIC24 (NÃO DIP16); preferir módulo breakout com labels C0-C15"`

**Status:** ✅ Corrigido em R2.

---

#### 🟡 AVISO 3 — Pinout físico mux no WIRING usa números de pino de módulo

**Arquivo:** `WIRING.csv` / `WIRING.xlsx`  
**Descrição:** Os números de pino físico do CD74HC4067 listados no WIRING correspondem a labels de módulos breakout populares (C0=2, C1=3...) mas não ao DIP24 TI oficial (C0=pin12, C1=pin13...).

**Decisão:** **Sem correção** — os módulos breakout (HiLetgo, LC Technology) são a forma padrão de uso em DIY e re-rotulam os pinos sequencialmente. O WIRING é correto para o contexto DIY. Adicionada nota no WIRING: "usar módulo breakout ou verificar datasheet específico do módulo."

**Status:** 🟡 Documentado — sem correção de código (comportamento esperado para módulo breakout).

---

## Rodada R2 — claude-sonnet-4.6 (verificação pós-fix)

### Verificações R2

| Item | Resultado |
|------|-----------|
| `delay()` bloqueante removido do encoder loop | ✅ Confirmado |
| `releaseEncoderButtons()` implementado e chamado no loop | ✅ Confirmado |
| `btnPressTime[NUM_ENCODERS * 2]` inicializado no setup | ✅ Confirmado |
| Comentário D14 corrigido | ✅ Confirmado |
| BOM: DIP24 corrigido | ✅ Confirmado |
| 18 botões HID ≤ 32 (limite Joystick lib) | ✅ Confirmado |
| SDA=D2 / SCL=D3 hardware I2C ATmega32U4 | ✅ Correto |
| A0 exclusivo para MUX_SIG (sem conflito D14) | ✅ Confirmado |
| Latência mux: 12 canais × 2µs = 24µs << 30ms mínimo EC11 | ✅ OK |
| Parsing serial SimHub non-blocking | ✅ OK |

### Novos achados em R2

Nenhum novo bug crítico identificado. Zero regressões introduzidas pelo fix do R1.

---

## Validações Técnicas Permanentes

### ✅ Mux CD74HC4067 funciona com encoders EC11?

**Sim, com a seguinte análise:**

| Parâmetro | Valor | Adequado? |
|-----------|-------|-----------|
| Settling time CD74HC4067 @ 5V | 125ns | ✅ |
| delayMicroseconds(2) no firmware | 2000ns | ✅ Margem segura |
| Tempo mínimo por passo EC11 (mecânico) | ~30ms | ✅ |
| Loop completo 12 canais (6 CLK + 6 DT) | ~24µs | ✅ |
| Latência adicional vs. leitura direta | ~24µs | ✅ Imperceptível |
| Rotações rápidas humanas | ~5-8 steps/s | ✅ |

**Conclusão:** A multiplexação via CD74HC4067 para leitura de CLK/DT de encoders mecânicos EC11 é tecnicamente válida e não causa perda de passos em uso normal.

---

### ✅ Joystick Library suporta 18 botões?

`MHeironimus ArduinoJoystickLibrary v2.x`: suporte a até **32 botões** em `JOYSTICK_TYPE_JOYSTICK`.  
18 botões utilizados no projeto (12 enc + 6 SW): ✅ Dentro do limite.

---

### ✅ Pro Micro suporta HID + Serial simultâneos?

O ATmega32U4 com firmware Arduino Leonardo/Pro Micro expõe **dois descritores USB compostos**:
1. `Joystick HID` — para os botões dos encoders
2. `CDC Serial` — para comunicação com SimHub

Ambos funcionam simultaneamente em um único cabo USB. ✅ Sem configuração adicional necessária.

---

### ✅ Adafruit_SSD1306 compatível com Wire + Joystick?

A biblioteca `Adafruit_SSD1306` usa `Wire.h` (I2C) que opera em pinos D2/D3 do Pro Micro. Não há conflito com a biblioteca `Joystick` (USB HID). ✅ Compatível.

---

## Arquivos Gerados e Revisados

| Arquivo | Status QA |
|---------|-----------|
| `firmware/buttonbox_v2.ino` | ✅ Revisado R1+R2, delay() removido |
| `README.md` | ✅ OK |
| `BOM.csv` / `BOM.xlsx` | ✅ DIP24 corrigido |
| `WIRING.csv` / `WIRING.xlsx` | 🟡 Módulo breakout — pin numbers OK para uso prático |
| `cad/buttonbox_case.scad` | ✅ OK |
| `print/buttonbox_case.stl` | ✅ Gerado |
| `simhub/custom_serial_bb.md` | ✅ OK |
| `previews/01-04.svg` | ✅ OK |

---

## Alertas para Construção

1. **CD74HC4067 — Use módulo breakout**, não chip bare-die. Módulos breakout da AliExpress/Shopee já vêm com pinos soldados e labels C0-C15 que correspondem ao WIRING.

2. **D6 no Pro Micro** é o pino do LED TX (azul) — vai piscar ao selecionar canais do mux. Sem impacto funcional, mas pode ser visível.

3. **D14 (MISO SPI)** como S2 do mux — funciona porque o SPI não é usado neste projeto. Se futuramente adicionar periférico SPI (ex: display TFT), haverá conflito.

4. **EC11 pull-up** — firmware usa `INPUT_PULLUP` interno (~20kΩ). Se houver ruído, adicionar resistores 10kΩ externos ao GND.

5. **OLED endereço I2C** — confirme se é `0x3C` (padrão) ou `0x3D`. Ajuste `OLED_ADDR` no firmware se necessário.

---

*QA-REPORT.md — Projeto P2.3 — Guilherme Basso iRacing DIY*
