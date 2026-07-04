#line 1 "/Users/guilhermebasso/Downloads/SIM-X-ButtonBox/05_firmware_arduino/button_box/README.md"
# Firmware Button Box — Arduino Pro Micro

## Bibliotecas necessárias
Instalar pela Arduino IDE → **Tools → Manage Libraries...**

| Biblioteca | Autor | Versão mínima |
|---|---|---|
| **Joystick** | Matthew Heironimus | 2.1.1 |
| **Encoder** | Paul Stoffregen | 1.4.2 |
| **FastLED** | Daniel Garcia | 3.6.0 |
| **U8g2** | Oliver Kraus | 2.34.x |

Se "Joystick" não aparecer na Library Manager, baixar do GitHub:
https://github.com/MHeironimus/ArduinoJoystickLibrary

## Como gravar (flash) o firmware

1. Instalar **Arduino IDE 2.x** (https://www.arduino.cc/en/software)
2. Em **Tools → Board** selecionar **Arduino Leonardo** (Pro Micro é compatível) ou instalar pacote **Sparkfun AVR**
3. Conectar o Pro Micro pelo cabo USB
4. **Tools → Port** → selecionar a porta com `(Arduino Leonardo)`
5. Abrir `button_box.ino`
6. **Sketch → Verify/Compile** (Ctrl+R) — deve compilar sem erros
7. **Sketch → Upload** (Ctrl+U)

## Pinagem
Ver `pinout.h` — contém mapeamento completo de pinos e HID buttons.

## Teste após o upload
1. Abrir **Serial Monitor** (Ctrl+Shift+M) em 115200 baud
2. Windows: **Configurações → Dispositivos → Mais → Dispositivos do jogo** → deve aparecer "SIM-X Button Box"
3. Clicar em "Propriedades" → testar cada botão / encoder / toggle

## Troubleshooting
- **Pro Micro travado (não reconhece):** apertar reset 2× rápido para entrar em bootloader (LED pisca rapidamente), em até 8s recarregar firmware
- **Botões "fantasma" pressionados:** verificar GND comum e resistores pull-up (já habilitados no firmware via `INPUT_PULLUP`)
- **Encoders pulando direção:** trocar A/B na fiação OU dividir por -1 no código

## ButtonBox fica aceso com o PC desligado (REV 38)

**Causa raiz:** a placa-mãe do seu PC entrega **+5V Standby (USB +5VSB)** mesmo com o PC desligado (recurso usado para wake-on-USB, charging de smartphone). O Arduino Pro Micro continua alimentado e seu firmware continua rodando. Os **LEDs iluminados dos botões** (laranja, verde, azul) e o **LED POWER** do painel são alimentados **diretamente do +5V do USB** — não passam por nenhum GPIO do Arduino, então o firmware não tem como apagá-los.

### O que o firmware REV 38 apaga sozinho (sem fazer nada)
Após **3 segundos** com o cabo USB desconectado (ou PC desligado) OU **60 segundos** de inatividade total (sem mexer em botão/encoder e sem comando do SimHub):
- ✅ **Rev Lights WS2812** (4 LEDs no topo) — apagam
- ✅ **Display OLED** — entra em low-power mode (~5 µA)
- ✅ **LED TX interno do Pro Micro** — apaga

Acorda imediatamente em qualquer atividade (botão, encoder, ou Serial reconectar quando o PC religa).

### Para apagar TUDO (incluindo LEDs dos botões), escolha uma das opções de hardware:

| Opção | Custo | Solução |
|---|---|---|
| **A. USB hub powered com switch físico** (recomendado) | ~R$ 50 | Hub USB 4 portas com botão liga/desliga individual por porta. Plug o ButtonBox em uma porta com switch. Quando desliga o PC (ou só quer apagar tudo), desliga o switch da porta. Funciona sem mexer no BIOS. |
| **B. Desabilitar ErP/Deep S5 no BIOS** | Grátis | Acessar BIOS/UEFI, procurar por `ErP Ready`, `Deep S5`, `EuP Function`, ou `USB Power in S4/S5` e desabilitar. Corta totalmente o +5VSB quando o PC desliga. **Atenção:** quebra wake-on-USB/teclado/mouse. |
| **C. Cabo USB com chave on/off in-line** | ~R$ 15 | Buscar "USB cable switch toggle" no AliExpress. Cabo USB-A macho/fêmea com botão físico no meio. Conecta entre o ButtonBox e o PC. |
| **D. Smart plug + carregador USB dedicado** | ~R$ 80 | Alimentar o ButtonBox por um carregador USB plugado num smart plug Wi-Fi. Controla por app/voz. Mas perde a comunicação Serial com SimHub a menos que use cabo USB-A duplo (data+power separados). |

**Recomendação Gui:** **Opção A** (USB hub powered com switch). Custo baixo, sem mexer em BIOS, fácil de plugar/desplugar.

