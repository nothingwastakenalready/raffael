# raffael — project and git context

This document is reference context, not a new instruction. The user's current
request always takes precedence.

Snapshot: 2026-09-17, Europe/Berlin.

## canonical project

- Product and repository: **raffael**
- GitHub: https://github.com/nothingwastakenalready/raffael
- GitHub username used locally: `Local240`
- Default branch: `main`
- Local checkout:
  `/Users/loneroza/Documents/Codex/2026-09-12/hi/work/nodeview`
- Implementation baseline before this context refresh: `231b977`
  (`feat: add first-run installer`)
- The remote is synchronized with `main`.
- Private runtime files such as `services.yaml`, credentials and databases must
  not be committed.

## product in one paragraph

Raffael is a self-hosted, open-source monitoring and observability application
for a home, homelab or small private infrastructure. It should answer what is
broken, what is getting worse and what is likely affected. The intended model
is workspace-first:

`user -> membership -> workspace -> devices/nodes -> services -> checks -> measurements/events`

The current product is a working local preview, not a finished public release.

## current local runtime

Docker Desktop is installed and working. The active Compose stack contains:

- Raffael at http://127.0.0.1:8080
- Mailpit at http://127.0.0.1:8025
- SQLite in the persistent `raffael-data` Docker volume
- a local ignored `services.yaml`

The stack binds to `127.0.0.1` and is therefore not exposed directly to the
LAN or internet.

Start or rebuild it with this complete command:

```bash
cd "/Users/loneroza/Documents/Codex/2026-09-12/hi/work/nodeview" && docker compose up -d --build
```

Stop it with:

```bash
cd "/Users/loneroza/Documents/Codex/2026-09-12/hi/work/nodeview" && docker compose down
```

## technology

- Python 3.11+ / FastAPI
- SQLAlchemy 2 / Alembic / SQLite
- asyncio scheduler with bounded concurrency
- Argon2id password hashing and server-side sessions
- React 19 / TypeScript / Vite / Vitest
- Docker Compose
- Mailpit for local SMTP preview
- PostgreSQL remains the direction for serious multi-user installations

## implemented backend

### monitoring

- YAML-configured HTTP and TCP checks
- continuous scheduling with per-service intervals
- bounded concurrent checks
- states: `pending`, `up`, `warning`, `critical`, `unknown`
- failure and recovery thresholds
- latency, response status, streaks and error details
- scheduler exceptions become `unknown` instead of killing the loop
- graceful engine startup and shutdown
- `GET /health`, `GET /services`, `POST /check`, `GET /state`

### persistence

- append-only measurement history in SQLite
- SQLAlchemy persistence boundary
- Alembic migrations
- bounded UTC history endpoint:
  `GET /history/{service_name}`
- history survives application restarts

### authentication and workspaces

- local account registration
- Argon2id password hashes
- server-side session records
- HttpOnly session cookie
- separate CSRF cookie and CSRF-protected logout
- `GET /auth/me`
- an owner membership and workspace on registration
- authentication gates around service, state and history reads when database
  auth is active
- email-verification token flow with single-use token digests
- separate newsletter double opt-in

### household client foundation

The integration catalog currently exposes:

- UniFi
- Philips Hue
- Proxmox
- Windows agent
- macOS agent
- generic HTTP/TCP

The API can list and create workspace-owned pending device records:

- `GET /integrations/catalog`
- `GET /household/devices`
- `POST /household/devices`

This is a storage and onboarding boundary. Real discovery, credential exchange
and telemetry adapters are not implemented yet.

## implemented frontend

- same-origin frontend served by FastAPI
- minimal two-step login: email first, password after Enter
- registration page with optional newsletter consent
- Raffael liquid-silver logo assets
- dark, lowercase dashboard direction
- star-field client constellation at the top
- real monitored services shown as status-colored line-art stars
- client name shown on each star; details appear through selection
- draggable star positions
- positions stored in browser `localStorage`
- leave/reload warning after moving stars
- current-state summaries and selected-monitor detail
- status-derived clusters
- add-client dialog using the household connector catalog direction
- five-second state refresh and stale-state handling

Current limitation: star layout is browser-local rather than saved per user and
workspace on the server. The dirty-state prompt also needs refinement because
positions are written to local storage immediately.

## transactional email

Local registration sends into Mailpit. Two separate messages exist:

1. account verification;
2. newsletter confirmation, only after explicit opt-in.

The current design uses:

- black canvas
- centered transparent Raffael PNG
- lowercase copy
- one heading and one underlined action
- no recipient details in the HTML body
- no provisional tagline

The phrase `raffael · local infrastructure` was removed. The public product
descriptor is intentionally undecided.

Production email is not active. The intended later path is Proton SMTP with a
custom domain and a dedicated sender such as `no-reply@domain.tld`. Never
commit the Proton SMTP token or account password.

## visual decisions

- Raffael must have its own identity and must not become a Checkmk clone.
- The dashboard direction is currently black, open, border-light and spatial.
- The constellation is the visual header and may impress, but it must use real
  clients rather than invented objects.
- Real graphs, clusters and operational details live below it.
- Status colors should use a restrained Raffael-inspired palette while remaining
  understandable without color alone.
- UI text should be lowercase wherever grammar and accessibility allow.
- The Raffael liquid-silver mark is the canonical logo.
- Avoid fake telemetry, generic admin templates, cyberpunk clutter and
  decorative topology that claims relationships the backend does not know.
- Interaction should stay on one page where possible; details should open
  through hover, selection, drawers or overlays.

Canonical logo assets:

- `web/public/assets/02-logo-varianten/logo-liquid-silver-weiss-transparent.png`
- `web/public/assets/02-logo-varianten/logo-liquid-silver-schwarz-transparent.png`

## verification status

The latest verified local state produced:

- Docker production image build passed
- Vite production build passed inside Docker
- application health check returned `{"status":"ok"}`
- Mailpit health and SMTP delivery passed
- account and newsletter test messages arrived
- transparent logo rendered correctly in Mailpit

## verbindlicher produkt-workflow

Raffael wird als funktionale App entwickelt. Die Datenkette ist maßgeblich:

`quelle -> gerät -> connector -> check -> status/latenz -> cluster/detail -> topology`

### arbeitsreihenfolge

1. **produktion schützen** — Datenbank sichern, Schema prüfen, Healthcheck
   ausführen; keine ungetesteten Migrationen auf dem Live-Volume.
2. **datenquelle anbinden** — Geräte ausschließlich über Website/API oder
   einen getesteten Importpfad anlegen; keine stillen Proxmox-Direktimporte als
   Endprodukt voraussetzen.
3. **connector ausführen** — Für jeden Gerätetyp eine echte Prüfung definieren:
   ICMP/Erreichbarkeit, HTTP/TCP, SNMP, Proxmox, Docker, SSH, UniFi, Hue und
   Agenten. Zugangsdaten bleiben in Secret-Referenzen und werden nie in Git,
   UI-Texten oder Logs ausgegeben.
4. **zustand persistieren** — `pending` bedeutet ausschließlich „noch nicht
   geprüft oder nicht konfiguriert“. Nach jedem Check werden Status, Latenz,
   Fehler, Zeitstempel und Erfolgs-/Fehlerstreifen gespeichert.
5. **UI aus echten Zuständen bauen** — Dashboard, Cluster, Detailansicht und
   Konstellation lesen dieselbe Zustandsquelle. Demo-Services dürfen nicht als
   Live-Werte erscheinen.
6. **topologie visualisieren** — Kanten stammen nur aus bekannten
   Eltern-/Abhängigkeitsbeziehungen. Ein benanntes Sternbild wird nur gewählt,
   wenn die Graphform ausreichend passt; sonst wird ein klares, automatisch
   gruppiertes Raffael-Muster erzeugt.
7. **verifizieren und deployen** — Backend-Tests, Frontend-Build, Migrationstest
   auf frischer und bestehender SQLite-Datenbank, Backup, Container-Neustart,
   `/health` und manueller Website-Test.

### definition of done

Ein Gerät gilt erst als fertig integriert, wenn es über die Website angelegt,
mit einem Connector geprüft, mit einem echten Status angezeigt, anklickbar und
in den zustandsbasierten Clustern enthalten ist. Ein Eintrag in einer Liste
allein ist kein fertiges Feature.

### aktueller blocker

Der Gerätebestand ist vorhanden, aber der Monitoring-Runner verarbeitet die
`devices`-Tabelle noch nicht. Deshalb bleiben diese Datensätze `pending`,
während die Demo-Einträge aus `services.yaml` weiterhin die alte Monitoring-
Ansicht speisen. Der nächste technische Meilenstein ist die gemeinsame
Zustandsquelle für Datenbankgeräte und Monitoring-Engine.
- full Python suite: **54 passed**
- two upstream Starlette/httpx deprecation warnings remain
- one harmless pytest cache warning occurred because the test mount was
  intentionally read-only

## recent pushed sequence

- `231b977 feat: add first-run installer`
- `6e30f80 docs: refresh readme for current dashboard`
- `194ffe3 add household connector foundation`
- `07211e6 document local email delivery`
- `cad07af add email verification and newsletter opt-in`
- `92ce1e8 reduce docker build context`
- `cf331dc refine transactional email design`

Earlier relevant baseline:

- `b2ca8d2 raffael remembers what happened`

## security posture

Raffael is suitable for trusted local development and continued open-source
review, but it is not ready for direct public internet exposure.

Existing safeguards:

- localhost-only Compose ports
- Argon2id password hashing
- server-side sessions
- CSRF-protected logout
- single-use email token digests
- workspace membership model
- non-root application container
- secrets excluded from examples and public API responses

Required before an internet-facing release:

- workspace ownership for all monitor/service/history data
- cross-workspace authorization tests across every owned object
- login and resend rate limiting
- password reset and session-management UI
- strict SSRF/egress policy for user-defined monitoring targets
- redirect, DNS-rebinding, loopback, link-local and metadata protections
- retention limits and storage-failure behavior
- dependency, secret, static and container scanning
- threat model, security review and public `SECURITY.md`
- an independent human review before a security-sensitive 1.0

## known unfinished work

- real UniFi, Hue and Proxmox connector runtimes
- secure agent enrollment for Windows and macOS
- reviewed LAN discovery instead of blind automatic enrollment
- real topology data, inferred relationships and affected-state semantics
- server-side constellation layout persistence
- state-change event table
- uptime aggregation
- measurement retention
- alerting and notifications
- PostgreSQL deployment path
- polished charts and history consumption in the UI
- final product descriptor/tagline
- production domain and production mail delivery

## deployment direction

The intended permanent host is the user's Proxmox mini PC.

Recommended shape:

1. a small Debian VM on Proxmox;
2. Docker Compose inside the VM;
3. 2 CPU cores, 2–4 GB RAM and roughly 20 GB disk to start;
4. Proxmox snapshots/backups plus an application-data backup;
5. local access first;
6. remote private access through WireGuard or Tailscale;
7. later a reverse proxy and HTTPS for a real domain.

Do not expose port `8080` directly to the internet. A later domain can point
to a reverse proxy while the application and its data remain on Proxmox.

## recommended next sequence

1. create the documented Proxmox/Debian deployment profile and backup procedure;
2. finish reliability work: retention, storage-failure handling, events and
   uptime;
3. connect household onboarding to real, least-privilege connector adapters;
4. persist constellation layouts per workspace and add real topology edges;
5. complete the internet-facing security gate before enabling a public domain.

## collaboration preferences

- communicate with the user in German
- keep explanations short, concrete and easy to scan
- write every terminal command as one complete copy-and-paste command, including
  the project `cd`
- test changes automatically and report actual results
- preserve the existing documentation style
- use small, coherent commits with normal human commit messages
- push completed, verified slices to GitHub
- keep the project open-source-reviewable and do not commit secrets
- ADHD mode remains active until the user says `stop adhd mode` or
  `normal mode`

## canonical files

- `PROJECT_CONTEXT.md` — this handoff and current memory
- `docs/architecture/product-vision.md`
- `docs/architecture/roadmap.md`
- `docs/architecture/ui.md`
- `docs/architecture/household-connectors.md`
- `docs/architecture/email-delivery.md`
- `src/raffael/api.py`
- `src/raffael/auth.py`
- `src/raffael/engine.py`
- `src/raffael/history.py`
- `src/raffael/email_templates.py`
- `web/src/Dashboard.tsx`
- `web/src/LoginPage.tsx`
- `web/src/visual-overrides.css`

When continuing in a fresh conversation, read this file first, then inspect
`git status`, recent commits and the relevant architecture document before
changing code.
