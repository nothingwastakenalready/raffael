# getting started

if you found this repo and want to make it work: nice. this is the short path.

raffael is a small self-hosted monitoring app. it runs locally with docker,
stores its data in a docker volume, and uses mailpit for safe local email.
mailpit catches account and password-reset emails without sending anything to
the real internet.

## what you need

- git
- docker desktop, or docker engine with docker compose
- a browser

you do not need a domain, a real mail account or a public server.

## start it

the easiest path is the installer:

```bash
./scripts/install.sh
```

on windows, use powershell:

```powershell
.\scripts\install.ps1
```

it checks git, docker and docker compose, creates `.env` and `services.yaml`,
then starts the containers. see `docs/installer.md` if it gets stuck on docker
desktop first-run setup.

manual path:

```bash
git clone https://github.com/nothingwastakenalready/raffael.git
cd raffael
cp .env.example .env
cp services.example.yaml services.yaml
docker compose up -d --build
```

open:

```text
http://127.0.0.1:8080
```

mailpit is here:

```text
http://127.0.0.1:8025
```

## create the first account

open raffael and create the first account.

only the first self-registration is expected for a normal local install.
after that, registration is closed by default so extra accounts are not created
accidentally.

if raffael sends a confirmation or reset email, open mailpit and use the newest
message:

```text
http://127.0.0.1:8025
```

## add a first sensor

in the dashboard, add a sensor under `active checks`.

good first checks:

```text
type: http
url:  https://example.com
```

or:

```text
type: tcp
host: 192.168.1.1
port: 80
```

use addresses from your own network. raffael is intentionally conservative about
what targets it will check.

## make it visible in your lan

for normal testing, keep the default localhost config.

if you want to open raffael from another device in the same home network, edit
`.env` and replace `127.0.0.1` with the IP address of the machine running
docker.

example:

```env
RAFFAEL_BIND_ADDRESS=192.168.1.50
RAFFAEL_MAILPIT_BIND_ADDRESS=192.168.1.50
RAFFAEL_PUBLIC_URL=http://192.168.1.50:8080
```

then restart:

```bash
docker compose up -d
```

open:

```text
http://192.168.1.50:8080
http://192.168.1.50:8025
```

do not expose this directly to the public internet.

## stop it

```bash
docker compose down
```

this stops the containers. the sqlite database stays in the docker volume.

to remove the data too:

```bash
docker compose down -v
```

only run that if you really want a fresh install.

## what works today

- local account login
- password reset through mailpit
- http checks
- tcp checks
- automatic tcp port discovery checks created from known devices
- current status
- latency
- uptime and downtime percentages from history
- durable history in SQLite
- dashboard with the starfield/constellation UI

## what is not there yet

- full Zabbix or Checkmk feature depth
- native proxmox metrics
- native unifi metrics
- SNMP polling
- docker container monitoring
- icmp ping as a first-class check
- alerting
- public internet deployment guidance
