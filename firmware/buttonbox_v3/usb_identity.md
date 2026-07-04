# Identidade USB do ButtonBox v3 (Windows)

Objetivo: fazer o dispositivo aparecer no Windows como **"Ultimate Sim ButtonBox"** em vez
de "Arduino Leonardo" / "USB Serial Device", e (opcionalmente) com um **VID/PID próprio**
para o pacote INF casar com precisão.

> O nome USB é definido **em tempo de compilação** pelo core do Arduino (flag
> `-DUSB_PRODUCT=...`). Não é algo que o `.ino` consiga mudar sozinho — por isso este guia.

---

## Método A — Mudar só o nome (recomendado, simples)

Mantém o VID/PID do seu clone (Leonardo/Pro Micro) e troca apenas a *product string*.

1. **Descubra a pasta do core AVR** (Arduino IDE 2.x no Windows):
   ```
   %LOCALAPPDATA%\Arduino15\packages\arduino\hardware\avr\<versão>\
   ```
   Lá existe um `boards.txt`. Se você usa o package da **SparkFun (Pro Micro)**, o caminho
   é `...\packages\SparkFun\hardware\avr\<versão>\`.

2. **Abra o `boards.txt`** e confirme o **prefixo da sua placa**:
   - Arduino Leonardo → prefixo `leonardo`
   - SparkFun Pro Micro → prefixo `promicro`

3. **Crie um `boards.local.txt`** na MESMA pasta do `boards.txt` (não edite o `boards.txt`
   direto — o `boards.local.txt` sobrepõe e é o método oficial de override). Conteúdo
   (exemplo para Leonardo):
   ```
   leonardo.build.usb_product="Ultimate Sim ButtonBox"
   leonardo.build.usb_manufacturer="Ultimate Sim"
   ```
   Para Pro Micro (SparkFun), troque o prefixo:
   ```
   promicro.build.usb_product="Ultimate Sim ButtonBox"
   promicro.build.usb_manufacturer="Ultimate Sim"
   ```

4. **Reabra o Arduino IDE**, recompile e **regrave** o firmware `buttonbox_v3`.

5. No Windows: **Gerenciador de Dispositivos** → desinstale o dispositivo antigo
   (marque "remover o software de driver", se aparecer) → desconecte/reconecte para o
   novo descritor ser relido.

> ✅ Isso já entrega a identidade visual desejada e funciona em qualquer clone, sem mexer
> em VID/PID nem no bootloader.

---

## Método B — Nome + VID/PID próprios (avançado, opcional)

Só vale se você quiser um INF que case **exclusivamente** com este dispositivo (útil se
você tem vários Pro Micro/Leonardo no PC).

1. **Escolha um VID/PID.** Não use VIDs de terceiros em produtos distribuídos. Para uso
   pessoal/educacional, o pool **pid.codes** reserva:
   - VID `0x1209`, PID `0x0001` → reservado para **testes** (ok para hobby local).

2. **`boards.local.txt`** (confira no `boards.txt` original os nomes exatos das chaves
   `*.vid.N` / `*.pid.N`, que variam por versão do core):
   ```
   leonardo.build.usb_product="Ultimate Sim ButtonBox"
   leonardo.build.usb_manufacturer="Ultimate Sim"
   leonardo.build.vid.0=0x1209
   leonardo.build.pid.0=0x0001
   leonardo.build.vid=0x1209
   leonardo.build.pid=0x0001
   ```

3. Recompile e regrave.

4. **Atualize `driver/UltimateSimButtonBox.inf`** com o novo VID/PID (passo a passo em
   `driver/INSTALL.md`).

> ⚠️ Mudar o VID/PID **não** altera o PID do bootloader Caterina (usado durante o reset
> de gravação) — a gravação continua funcionando, mas o PID de "modo runtime" muda. Se o
> Windows passar a pedir driver, reinstale o pacote INF atualizado.

---

## Verificar o resultado

**Gerenciador de Dispositivos** → *Portas (COM & LPT)* → seu dispositivo → **Propriedades**
→ aba **Detalhes** → propriedade **IDs de Hardware**:

```
USB\VID_2341&PID_8036&...      ← VID/PID (Método A mantém os originais)
```

O **nome exibido** na lista usa a *product string* (`USB_PRODUCT`) que você definiu.

---

## Relação com o pacote "driver" (INF)

- O `driver/UltimateSimButtonBox.inf` associa o **VID/PID** ao `usbser.sys` nativo do Windows e
  define o nome amigável da porta COM. Veja `driver/INSTALL.md`.
- Método A → o INF deve usar o VID/PID original do seu clone (descubra em "IDs de Hardware").
- Método B → o INF deve usar o VID/PID custom que você definiu aqui.
