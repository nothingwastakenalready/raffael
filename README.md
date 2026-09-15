# raffael

i have too many random things running at home and got tired of checking them one by one.

so this checks them.

there are obviously a hundred tools that do this already. i didn't want any of them.

## right now

- local account login
- database-backed devices and sensors
- http + tcp checks
- response time
- latency, uptime and downtime from stored history
- http api
- always-on scheduler
- current state with `pending / up / warning / critical / unknown`
- durable sqlite measurement history
- bounded per-service history api with utc time ranges
- failure/recovery thresholds so one bad sample does not immediately become the apocalypse
- browser ui with a starfield/constellation overview
- docker because leaving a terminal open forever is stupid
- local mailpit inbox for safe email development

## if you found this

if you found this and want to make it run: nice. start here:

```text
docs/getting-started.md
```

that guide explains docker, `.env`, the first account, mailpit and the first
sensor without assuming you already know the weird corners of this repo.

there is also a small installer:

```bash
./scripts/install.sh
```

windows:

```powershell
.\scripts\install.ps1
```

details are in `docs/installer.md`.

config reference:

```text
docs/configuration.md
```

## run it locally

you only need git and docker desktop, or docker engine with compose.

```bash
git clone https://github.com/nothingwastakenalready/raffael.git
cd raffael
cp .env.example .env
cp services.example.yaml services.yaml
docker compose up -d --build
```

then open:

```text
http://127.0.0.1:8080
```

for local email development, open the mailpit inbox at:

```text
http://127.0.0.1:8025
```

mailpit captures messages locally and does not deliver them to real recipients.
see `docs/architecture/email-delivery.md` for proton smtp configuration and
the planned confirmation/newsletter flows.

the same process serves the api, scheduler and built ui. compose binds only to
localhost by default. keep it that way unless you deliberately want lan access.
for lan access, edit `.env` and set the bind addresses and public url to the
host's lan ip:

```env
RAFFAEL_BIND_ADDRESS=192.168.1.50
RAFFAEL_MAILPIT_BIND_ADDRESS=192.168.1.50
RAFFAEL_PUBLIC_URL=http://192.168.1.50:8080
```

do not expose raffael directly to the public internet.

create the first account in the browser. if you need password reset or account
email, open mailpit and use the newest message.

add real sensors from the dashboard, or change `services.yaml` before the first
database import, then restart:

```bash
docker compose restart
```

api is still there:

```text
GET  /health
GET  /ready
GET  /state
GET  /checks
POST /checks
PATCH /checks/{check_id}
DELETE /checks/{check_id}
GET  /checks/{check_id}/history
POST /checks/{check_id}/run
GET  /household/devices
POST /household/devices
PATCH /household/devices/{device_id}
GET  /household/clients
POST /household/clients
POST /integrations/{source}/clients/import
POST /household/discover
POST /household/discover/adopt
```

`/ready` checks database and scheduler readiness. `/state` shows the current
workspace-filtered monitoring state. `/checks` manages stored sensors. the old
raw `/check` endpoint only remains as a `410 gone` compatibility stub.

config is still deliberately boring:

```yaml
services:
  - name: example
    url: https://example.com
    interval: 30
    failure_threshold: 2
    success_threshold: 1

  - name: ssh
    type: tcp
    host: 192.0.2.10
    port: 22
    timeout: 2
```

monitoring fields are optional. defaults are 30s interval, two failures before critical and one success to recover.

`services.yaml` is ignored on purpose. i'm eventually pointing this at things that don't need to be on github.

## ui dev

the ui is deliberately small and easy to change. run the api on `127.0.0.1:8080`, then:

```bash
cd web
npm install
npm run dev
```

vite proxies the raffael api during development. the production docker image builds the frontend and serves it from fastapi, so there is no second service to operate.

the current screen uses devices as stars and sensors underneath them. it is
already real monitoring data, but not yet the final node/workspace graph
described in `docs/architecture/ui.md`.

## where this is going

this stopped being just a cli experiment.

raffael is heading toward a small self-hosted monitoring thing with history, users/workspaces, a proper node model, dependency graphs and eventually agents.

not all at once. that would be how this becomes terrible.

durable measurement history is in place. retention, richer charts and
state-change events are the next pieces of that backend slice.

see `docs/architecture/product-vision.md`, `docs/architecture/roadmap.md` and `docs/architecture/ui.md` for the longer version.

the reproducible proxmox/mini-pc hierarchy test is documented in
`docs/architecture/proxmox-minipc-test.md`.

the monitoring data model is documented in
`docs/architecture/monitoring-sensors.md`: one star remains one device, while
multiple executable sensors can run underneath it.

## dev

```bash
python -m pip install -e '.[test]'
pytest

cd web
npm test
npm run build
```

python 3.11+.

Before deploying, run `scripts/pre-deploy-check.sh` and follow
`docs/deployment.md`.
