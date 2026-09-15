# installer

the installer is for people who just want raffael running and do not care about
every docker detail yet.

it checks for git, docker and docker compose, creates the local config files,
builds the containers and starts raffael.

## macos / linux

from inside the repo:

```bash
./scripts/install.sh
```

on macos it can install homebrew, git and docker desktop when they are missing.
docker desktop still has to be started once by the user because macos apps need
their first-run setup.

on linux it tries `apt`, `dnf` or `pacman` and may ask for `sudo`.

## windows

open powershell in the repo:

```powershell
.\scripts\install.ps1
```

it uses `winget` for git and docker desktop. after installing git or docker,
open a new powershell window and run the installer again. docker desktop needs
to finish its own first-run setup before containers can start.

## what it creates

- `.env` from `.env.example`, if missing
- `services.yaml` from `services.example.yaml`, if missing
- docker volume `raffael-data`
- the raffael and mailpit containers

existing `.env` and `services.yaml` files are left alone.

## after install

open:

```text
http://127.0.0.1:8080
```

mailpit is here:

```text
http://127.0.0.1:8025
```

create the first account in the browser.

## not magic

the installer does not open router ports, does not expose raffael to the
internet and does not delete data.

if docker desktop says it needs a restart or a license/setup click, do that and
run the installer again.
