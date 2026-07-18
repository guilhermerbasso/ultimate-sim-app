# Local MQTT v1 certification target

- Disabled by default; the app accepts only `127.0.0.1` or `::1`.
- No cloud broker or user-supplied credential field exists.
- The app generates an OS-protected publisher secret plus separate local reader/command
  role files; no role secret enters settings, logs, status, or MQTT payloads.
- Mosquitto rejects anonymous clients and separates publisher, read-only, and
  default-off command capabilities by authenticated user and listener.
- Fast telemetry is QoS 0, never retained, and capped at 10 Hz.
- Availability, session, health, and schema state are QoS 1 retained with expiry.
- Events and allowlisted non-driving commands are QoS 1 and idempotent.
- Change `simrig` consistently in the ACL files when using another instance ID.

Enable the target once to generate the runtime bundle shown in Settings, then run
Mosquitto from that generated directory:

```text
mosquitto -c mosquitto-loopback.conf -v
```

The committed files are a secret-free reference template and deliberately omit
password files, so they fail closed until provisioned. Only enable the command
listener with the app command namespace. Never bind these listeners to LAN/WAN.
