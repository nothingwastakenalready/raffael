# monitoring sensors

raffael keeps the sky interface, but the data model underneath is now closer to
checkmk, zabbix and grafana-style monitoring:

- one star represents one device
- one device can own many sensors
- a sensor is an executable check, for example http, tcp or automatic tcp probe
- the star shows the worst current sensor state for that device
- the selected device panel shows the sensors below that star

## current sensor data

every persisted sensor state can expose:

- current status
- current latency
- last check time
- http status, where relevant
- success and failure streaks
- uptime percentage from recent samples
- downtime percentage from recent samples
- average latency from recent samples
- down-event count from recent samples
- technical details such as target, host, port and automatic probe result

the history table stores the same technical details so a restart does not erase
the monitoring evidence.

## prometheus export

`GET /metrics` exposes the current scheduler state in Prometheus text format.
the first export is intentionally small: state, last latency and last
success/failure timestamps for active checks.

metric labels are limited to stable check identity and type:

- `check_id`
- `check_name`
- `check_type`
- `status` on `raffael_check_state`

targets, hosts, workspace ids, error messages, technical details and credential
references are not exported as labels.

## current sensor types

- `http` checks one http or https url.
- `tcp` checks one host and port.
- `tcp_auto` checks a device host against known lan service ports and records the
  first responding port.

these are real reachability and latency checks. they are not placeholders.

## next sensor types

the next production-grade monitoring work should add connector-backed sensors:

- snmp for generic network and host metrics
- proxmox for node, vm, lxc, storage and backup state
- unifi for clients, aps, switches, ports and controller health
- docker for container state
- tls certificate expiry for https targets
- dns checks for local resolver health

the design goal is unchanged: the sky stays calm and visual, while the selected
device view carries the serious operational data underneath.
