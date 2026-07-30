# SimHub — Custom Serial Device — Button Box V2 OLED

> [!CAUTION]
> **QUARANTINED — superseded SimHub mapping.** This configures SimHub for
> `firmware/buttonbox_v2/buttonbox_v2.ino`, whose serial mapping does not match
> the canonical SIM-X protocol in `app-v2/src/main/protocol.ts`. Following it
> while the app is also connected puts two writers on one COM port, and the
> wiring it assumes comes from the quarantined `WIRING.csv`.
> See [`../docs/HARDWARE-QUARANTINE.md`](../docs/HARDWARE-QUARANTINE.md) (Q3).
> Kept for historical reference only.

## Objetivo

Enviar dados de telemetria do iRacing para o Pro Micro via USB Serial, para que o firmware `buttonbox_v2.ino` exiba os valores no display OLED em tempo real.

---

## Configuração no SimHub

### Passo a passo

1. Abra o SimHub.
2. No menu lateral esquerdo: **Arduino** → **Manage Arduino devices**.
3. Role até a seção **Custom Serial Devices** e clique em **Add new custom serial device**.
4. Preencha:

| Campo | Valor |
|-------|-------|
| **Port** | Porta COM do Pro Micro (ex: COM8 no Windows, /dev/ttyACM0 no Linux) |
| **Baud Rate** | `115200` |
| **Device name** | `ButtonBox V2 OLED` |
| **Update interval (ms)** | `100` (10 Hz — suficiente para dados de setup) |

5. No campo **Update message**, cole o template abaixo.
6. Clique em **Save**.
7. Clique em **Test** para verificar a conexão.

---

## Template do SimHub (Update Message)

Cole exatamente este conteúdo no campo **Update message**:

```
BB:[format]{iRacing_BrakeBias*100:.1f}[/format]|MAP:[iRacing_dcEngineMap]|TC:[iRacing_dcTractionControl]|ABS:[iRacing_dcABS]|FUEL:[format]{iRacing_FuelLevel:.1f}[/format]
```

> **Nota:** O SimHub substituirá as propriedades entre colchetes pelos valores reais do iRacing antes de enviar.

### Exemplo de string enviada ao Pro Micro:

```
BB:51.5|MAP:3|TC:5|ABS:2|FUEL:28.4
```

---

## Propriedades iRacing Utilizadas

| Propriedade SimHub | Descrição | Tipo |
|-------------------|-----------|------|
| `iRacing_BrakeBias` | Brake Bias (0.0–1.0, multiplicado por 100 = %) | float |
| `iRacing_dcEngineMap` | Engine MAP (número inteiro 1-12) | int |
| `iRacing_dcTractionControl` | TC Level (0-12) | int |
| `iRacing_dcABS` | ABS Level (0-12) | int |
| `iRacing_FuelLevel` | Combustível restante (litros) | float |

> **Dica:** Para verificar os nomes exatos das propriedades na sua versão do SimHub:
> **SimHub → Additional Plugins → Properties Browser** → filtrar por "iracing"

---

## Alternativa: NCalc com formatação condicional

Se quiser exibir "---" quando o carro não estiver na pista (fora da sessão):

```
BB:[format]{(iRacing_IsInCar ? iRacing_BrakeBias*100 : 0.0):.1f}[/format]|MAP:[iRacing_dcEngineMap]|TC:[iRacing_dcTractionControl]|ABS:[iRacing_dcABS]|FUEL:[format]{iRacing_FuelLevel:.1f}[/format]
```

---

## Troubleshooting

### OLED não exibe nada

1. Verifique no Device Manager (Windows) ou `dmesg` (Linux) se o Pro Micro está visível como porta serial.
2. Confirme que o baud rate é `115200` — tanto no SimHub quanto no `Serial.begin(115200)` do firmware.
3. Teste enviando manualmente via monitor serial (Arduino IDE): `BB:50.0|MAP:3|TC:5|ABS:2|FUEL:30.0`

### Valores congelados no OLED

- Isso acontece se a sessão iRacing não está ativa. É comportamento esperado — o SimHub só envia dados quando detecta telemetria.
- Você pode adicionar um fallback no firmware para exibir `---` após timeout de 3 segundos sem dados.

### OLED e Joystick no mesmo Pro Micro

O Pro Micro expõe dois "dispositivos" via USB:
1. **Joystick HID** — para os encoders
2. **Porta Serial CDC** — para os dados do SimHub

Ambos funcionam simultaneamente no mesmo cabo USB. Não é necessário nenhuma configuração adicional.

---

## Referências

- [SimHub Custom Serial Devices Wiki](https://github.com/SHWotever/SimHub/wiki/Custom-Serial-devices)
- [SimHub Available Properties — iRacing](https://github.com/SHWotever/SimHub/wiki/Available-Properties)
- [iRacing SDK Session Data](https://members.iracing.com/membersite/member/Home.do)
