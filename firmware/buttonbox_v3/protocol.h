#pragma once

// ─── Device / protocol identity ──────────────────────────────────────────────
// These strings are reported by the ">ID?" command and let the Manager app
// recognise a genuine ButtonBox. The USB *product string* shown by Windows is
// configured separately at compile time — see usb_identity.md.

#define DEVICE_NAME    "UltimateSimButtonBox"   // logical id in ">ID?" (not the USB name)
#define FW_VERSION     "3.0.0"
#define PROTO_VERSION  1
