# raffael roadmap

this is the product roadmap, not a promise to ship all of it quickly.

each phase should leave raffael in a working state. detailed implementation plans live separately under `docs/superpowers/plans/` immediately before execution.

## stream 0 - project foundations

goal: make future changes cheap and reviewable.

deliverables:

- keep http/tcp core behavior stable
- shared check dispatcher
- package boundaries for monitoring/core/api later
- ci on supported python versions
- docker image build in ci
- architecture docs / adrs for decisions that become hard to reverse
- security policy before accepting meaningful outside use

exit criteria:

- tests green
- one documented runtime path
- no duplicate cli/api monitoring logic

## stream 1 - always-on server (v0.2)

goal: turn the cli tool into a service.

scope:

- fastapi application
- `GET /health`
- `GET /services`
- `POST /check`
- shared dispatcher for http/tcp
- dockerfile
- `compose.yaml`
- api tests
- docker build ci

explicitly still private/trusted-network only.

exit criteria:

- `docker compose up -d` produces a working api
- http/tcp checks behave identically from cli and api
- ci verifies python and image build

## stream 2 - monitoring engine + scheduler (v0.3)

goal: checks run continuously without a user request.

scope:

- check ids and persistent configuration model
- scheduler with bounded concurrency
- intervals and timeouts
- current-state cache/model
- state transitions (`up`, `warning`, `critical`, `unknown`, `pending`)
- failure/success thresholds to avoid flapping
- structured error categories
- graceful startup/shutdown

do not add a ui before the engine can produce trustworthy state.

exit criteria:

- configured checks execute on schedule
- state transitions are deterministic and tested
- restart behavior is defined

## stream 3 - persistence + history (v0.4)

goal: answer `what changed?` rather than only `what is true right now?`.

progress: v0.4 is effectively complete: scheduled measurements persist in sqlite through sqlalchemy, migrations exist, bounded utc history is exposed and the dashboard derives latency, uptime and downtime from recent samples. state-change events and retention are still future polish.

scope:

- sqlalchemy persistence layer
- alembic migrations
- initial sqlite development/small-install path
- postgresql production/multi-user path
- measurements
- state-change events
- retention policy
- latency history
- uptime calculation
- api endpoints for history

important design work:

- separate current state from measurement history
- avoid unbounded database growth
- define timestamp/timezone policy (utc internally)

exit criteria:

- restart preserves configuration/history
- migrations work from a clean database and previous schema
- latency/uptime can be queried for a time range

## stream 4 - first real web product (v0.5)

goal: raffael becomes usable without editing yaml or reading json.

scope:

- typescript/react/vite frontend
- application shell/navigation
- nodes list
- services/checks list
- create/edit/delete monitor flow
- current state
- latency display
- latency history chart
- responsive desktop-first layout
- dark visual system

Hexagons start here only after basic information architecture works.

exit criteria:

- normal monitoring setup is possible through ui
- no config file required for common use
- current state and history visible

## stream 5 - accounts + workspaces + tenant isolation (v0.6)

goal: multiple people can use one raffael instance safely.

Data model:

- users
- workspaces
- memberships
- roles
- workspace-owned nodes/services/checks/history

scope:

- registration/login/logout
- Argon2id password hashing
- server-side sessions
- secure/HttpOnly/SameSite cookies
- CSRF strategy
- session rotation/revocation
- login throttling/rate limiting
- authorization dependency/service
- owner/admin/member/viewer roles
- audit events for auth/privilege changes
- cross-workspace isolation tests

Security gate:

No internet-facing deployment recommendation until this stream has a dedicated security review.

exit criteria:

- two workspaces cannot read/change each other's data
- privileged operations are role-gated
- auth lifecycle is tested

## stream 6 - the raffael visual identity (v0.7)

goal: the interface stops looking like another CRUD monitoring dashboard.

scope:

- hexagonal node overview
- node status spectrum
- latency in node tile
- grouping/clustering
- degraded/affected semantics
- quick filters
- node detail drawer/page
- accessibility alternatives to color-only state
- keyboard navigation where practical

Rules:

- status color has one meaning everywhere
- do not copy Checkmk geometry/layout one-to-one
- unknown/pending must not look healthy

exit criteria:

- a problem node can be located visually within seconds
- interface remains useful with dozens of nodes
- status remains understandable without color alone

## stream 7 - topology + dependency graph (v0.8)

goal: answer `what else is affected?`.

scope:

- explicit dependency data model
- node/service dependency edges
- topology api
- interactive dependency graph
- downstream affected state
- root-cause candidate heuristic
- cycle detection

Important rule:

raffael may suggest likely upstream causes but must not claim causal certainty from topology alone.

exit criteria:

- users can model dependencies
- failures propagate as `affected` without overwriting the actual check state
- graph remains navigable on realistic small/medium homelabs

## stream 8 - raffael agent (v0.9)

goal: go beyond outside-in reachability checks.

Protocol first, agent implementation second.

Server scope:

- agent registration/enrollment
- per-agent identity
- authenticated transport
- revocation
- heartbeat
- ingestion api/protocol
- capability/version negotiation

Agent metrics initially:

- uptime/load
- CPU
- RAM
- filesystem usage
- network counters
- basic host metadata

Then:

- docker/container stats
- temperatures/sensors where portable
- service/process checks

Security:

- least privilege
- no arbitrary remote command execution
- explicit capability model
- rotation/revocation of enrollment credentials

exit criteria:

- Linux host can enroll and report metrics securely
- agent loss is visible distinctly from monitored-service failure

## stream 9 - alerting + operations (v0.10)

goal: raffael becomes useful when nobody is staring at it.

scope:

- alert rules
- recovery notifications
- deduplication
- cooldowns
- maintenance windows
- acknowledgement
- notification destinations
- webhook first
- email later
- optional common chat integrations

exit criteria:

- transient failures do not create alert storms
- maintenance can silence expected events
- resolved state is communicated

## stream 10 - observability interoperability (v0.11)

goal: fit into existing infrastructure rather than replacing every tool.

scope:

- prometheus-compatible `/metrics`
- documented labels/naming
- api tokens/service accounts
- import/export configuration
- webhooks/events api
- optional OpenTelemetry exploration after core metrics are stable

Non-goal:

- PromQL clone
- Grafana clone

exit criteria:

- prometheus can scrape raffael itself and monitor/check metrics
- third-party tools can consume stable documented data

## stream 11 - desktop application (v0.12)

goal: package the mature web experience as a native desktop client.

Preferred direction:

- Tauri 2
- same frontend as web
- explicit capability/permission configuration
- OS credential/keychain storage for long-lived credentials
- signed builds
- updater only after release signing and ci are mature

Possible connection modes:

1. connect to an existing raffael server
2. later evaluate bundled local server for a single-machine experience

Start with mode 1. Bundling backend/database creates a separate lifecycle problem and is not necessary initially.

exit criteria:

- Windows/macOS/Linux client can authenticate to a server
- secrets are not stored in browser localStorage/plain files
- update path is signed/documented

## stream 12 - open-source release quality (1.0 candidate)

goal: a stranger can safely install, understand and contribute to raffael.

scope:

- choose/confirm license
- installation docs
- architecture docs
- backup/restore guide
- upgrade/migration guide
- reverse proxy/TLS guide
- SECURITY.md
- CONTRIBUTING.md
- CODE_OF_CONDUCT.md if community requires it
- threat model
- dependency update automation
- static/security analysis
- container vulnerability scanning
- secret scanning
- OpenSSF Scorecard review
- reproducible release process
- tagged releases + changelog
- sample configs without private addresses/secrets

exit criteria:

- clean install works from docs
- upgrade path is tested
- security reporting path exists
- ci/release artifacts are repeatable

# parallel workstreams

Some work does not map cleanly to versions and runs continuously.

## a - security

Threat model updated whenever trust boundaries change.

Focus areas:

- authentication/session security
- tenant isolation
- SSRF/egress control
- agent enrollment
- secrets
- dependency/supply-chain security
- logging without leaking sensitive infrastructure

## b - ux/design

Maintain a small design language instead of ad-hoc components.

Focus:

- status semantics
- hex geometry
- information density
- latency/history charts
- topology interaction
- accessibility

## c - quality

- TDD for behavioral changes
- integration tests around api/database
- migration tests
- security regression tests
- ui tests for critical flows
- release smoke tests

## d - documentation/open source

Docs evolve with features rather than being written at the end.

# working method

for each stream:

1. write/approve a focused design spec
2. write a detailed implementation plan
3. implement test-first
4. run local verification
5. run ci
6. review security impact
7. update docs
8. cut a version only when the slice is actually coherent

No giant rewrite. Every stream grows the existing working product.

# immediate sequence

the next implementation sequence is:

1. finish v0.2 api + docker as already designed
2. scheduler/state model
3. persistence/history
4. first web ui
5. accounts/workspaces
6. hexagon node view
7. dependency graph
8. agent

That order is deliberate. Pretty topology on top of an unreliable state engine is just a screensaver.
