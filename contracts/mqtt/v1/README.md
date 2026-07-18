# Local MQTT v1 certification target

- Disabled by default; the app accepts only `127.0.0.1` or `::1`.
- No cloud broker, account, password, token, certificate, or credential field exists.
- Mosquitto listeners separate publisher, read-only, and default-off command capabilities.
- Fast telemetry is QoS 0, never retained, and capped at 10 Hz.
- Availability, session, health, and schema state are QoS 1 retained with expiry.
- Events and allowlisted non-driving commands are QoS 1 and idempotent.
- Change `simrig` consistently in the ACL files when using another instance ID.

Run Mosquitto from this directory:

```text
mosquitto -c mosquitto-loopback.conf -v
```

Only uncomment the command listener after enabling commands in the app. Never
bind these credential-free listeners to a LAN/WAN interface.
