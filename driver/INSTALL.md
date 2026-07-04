# Instalação do "driver" — Ultimate Sim ButtonBox (Windows)

## TL;DR — você provavelmente NÃO precisa instalar driver

O ButtonBox (Arduino Pro Micro / Leonardo) é **class-compliant**. No **Windows 10/11**
ele é reconhecido **automaticamente** como:

- **Joystick HID** (os 18 botões aparecem no iRacing sem nada a instalar), e
- **Porta serial (COM)** via o driver nativo `usbser.sys`.

👉 Para o dispositivo aparecer com **nome próprio** ("Ultimate Sim ButtonBox") sem instalar
nada, o caminho recomendado é mudar a *product string* do firmware — veja
[`../firmware/buttonbox_v3/usb_identity.md`](../firmware/buttonbox_v3/usb_identity.md)
(Método A). Isso resolve a estética **sem** pacote INF.

Use o pacote INF abaixo **apenas** se quiser:
- forçar o nome amigável da **porta COM** na lista de "Portas (COM & LPT)", ou
- suportar uma versão **antiga** do Windows que não traga o `usbser.sys` automático.

---

## 1. Descobrir o VID/PID do seu dispositivo

1. Conecte o ButtonBox.
2. **Gerenciador de Dispositivos** → *Portas (COM & LPT)* (ou *Outros dispositivos*).
3. Botão direito no dispositivo → **Propriedades** → aba **Detalhes** →
   propriedade **IDs de Hardware**. Anote algo como:
   ```
   USB\VID_2341&PID_8036
   ```
4. Se esse VID/PID **não** estiver na seção `[DeviceList.*]` do `UltimateSimButtonBox.inf`,
   **edite o INF** e adicione/ajuste a linha correspondente (em ambas as seções
   `NTamd64` e `NTarm64`).

---

## 2. Instalar o pacote INF

> ⚠️ **Assinatura.** Este INF é **não assinado**. O Windows moderno exige drivers
> assinados por padrão. Como ele apenas reaponta para o `usbser.sys` nativo (não traz
> binário próprio), as opções abaixo cobrem o uso pessoal.

### Opção A — Gerenciador de Dispositivos (mais simples)
1. Gerenciador de Dispositivos → botão direito no dispositivo → **Atualizar driver**.
2. **Procurar software de driver no computador**.
3. Aponte para a pasta `driver/` (que contém `UltimateSimButtonBox.inf`).
4. Aceite o aviso de driver não assinado, se aparecer.
5. O dispositivo passa a aparecer como **"Ultimate Sim ButtonBox (COMx)"**.

### Opção B — `pnputil` (linha de comando, admin)
```powershell
# Prompt/PowerShell como Administrador, dentro da pasta driver\
pnputil /add-driver UltimateSimButtonBox.inf /install
```

### Se o Windows recusar por falta de assinatura
Para uso pessoal, escolha um:
- **Reiniciar com verificação de assinatura desabilitada:**
  *Configurações → Sistema → Recuperação → Inicialização Avançada → Reiniciar agora →
  Solucionar problemas → Opções avançadas → Configurações de Inicialização → Reiniciar →
  tecla **7** (Desabilitar imposição de assinatura de driver)*. Instale o INF e reinicie.
- **Auto-assinar** com um certificado de teste (`makecert`/`signtool`, modo test-signing).
  Avançado; normalmente desnecessário.

> 💡 Lembre-se: se você só quer o **nome bonito**, o **Método A do firmware** entrega isso
> sem assinatura e sem instalar driver. O INF é para casos específicos.

---

## 3. Desinstalar

- Gerenciador de Dispositivos → botão direito no dispositivo → **Desinstalar dispositivo**
  → marque "Tentar remover o driver" → OK. Reconecte para voltar ao driver nativo.
- Ou via `pnputil /delete-driver oemXX.inf /uninstall` (descubra o `oemXX.inf` com
  `pnputil /enum-drivers`).

---

## 4. Relação app ⇆ porta (lembrete importante)

A porta COM é **exclusiva**: o **ButtonBox Manager** e o **SimHub** não podem abri-la ao
mesmo tempo. Configure pelo app com o SimHub fechado; ao correr, feche o app para o SimHub
assumir a porta. (O monitor de inputs do app usa a API de Gamepad, não a serial.)

---

## Arquivos

| Arquivo | O quê |
|---|---|
| `UltimateSimButtonBox.inf` | Pacote INF (aponta p/ `usbser.sys` nativo + nome amigável) |
| `INSTALL.md` | Este guia |
