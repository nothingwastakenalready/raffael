import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ServiceState, StatusTone } from "./model";
import { presentState, summarizeStates } from "./model";
import { Logo } from "./Logo";

interface DashboardProps {
  states: ServiceState[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

interface HouseholdDevice {
  id: number;
  name: string;
  connector: string;
  endpoint: string | null;
  parent_id: number | null;
  metadata: Record<string, unknown>;
  status: string;
}

interface CheckConfig {
  id: number;
  device_id: number;
  name: string;
  type: "http" | "tcp" | "tcp_auto";
  url: string | null;
  host: string | null;
  port: number | null;
  interval: number;
  active: boolean;
}

const summaryOrder: Array<Exclude<StatusTone, "unknown"> | "unknown"> = [
  "healthy",
  "warning",
  "critical",
  "unknown",
  "pending"
];

const CONSTELLATION_STORAGE_KEY = "raffael.constellation.positions";

function checkedLabel(value: string | null): string {
  if (!value) return "not yet";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function detailValue(value: string | number | boolean | null): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function constellationPosition(index: number, total: number): { x: number; y: number } {
  const columns = Math.max(3, Math.ceil(Math.sqrt(total * 1.8)));
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: 14 + (column / Math.max(1, columns - 1)) * 72 + (row % 2 ? 5 : 0),
    y: 34 + (row % 3) * 25
  };
}

function stateKey(state: ServiceState): string {
  return state.check_id == null ? state.name : `check:${state.check_id}`;
}

function statusRank(tone: StatusTone): number {
  return { critical: 5, warning: 4, unknown: 3, pending: 2, healthy: 1 }[tone];
}

function primarySensor(states: ServiceState[]): ServiceState | null {
  return states
    .slice()
    .sort((left, right) => statusRank(presentState(right).tone) - statusRank(presentState(left).tone))
    [0] ?? null;
}

function average(values: number[]): number | null {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

type Point = { x: number; y: number };
const CONSTELLATION_TEMPLATES: Array<{ name: string; points: Point[]; minimum: number; family: "hub" | "chain" | "cross" }> = [
  { name: "Großer Wagen", family: "hub", minimum: 7, points: [{ x: 18, y: 52 }, { x: 31, y: 42 }, { x: 44, y: 49 }, { x: 57, y: 39 }, { x: 72, y: 33 }, { x: 82, y: 52 }, { x: 67, y: 62 }] },
  { name: "Schwan", family: "hub", minimum: 6, points: [{ x: 50, y: 14 }, { x: 50, y: 38 }, { x: 50, y: 62 }, { x: 50, y: 86 }, { x: 28, y: 52 }, { x: 72, y: 52 }] },
  { name: "Skorpion", family: "hub", minimum: 8, points: [{ x: 22, y: 25 }, { x: 38, y: 34 }, { x: 52, y: 48 }, { x: 60, y: 65 }, { x: 73, y: 76 }, { x: 84, y: 66 }, { x: 78, y: 52 }, { x: 64, y: 43 }] },
  { name: "Cassiopeia", family: "chain", minimum: 5, points: [{ x: 15, y: 48 }, { x: 30, y: 32 }, { x: 45, y: 55 }, { x: 60, y: 32 }, { x: 76, y: 48 }] },
  { name: "Löwe", family: "chain", minimum: 7, points: [{ x: 18, y: 48 }, { x: 30, y: 34 }, { x: 44, y: 29 }, { x: 57, y: 40 }, { x: 70, y: 31 }, { x: 80, y: 52 }, { x: 61, y: 68 }] },
  { name: "Stier", family: "chain", minimum: 6, points: [{ x: 18, y: 42 }, { x: 35, y: 55 }, { x: 50, y: 46 }, { x: 64, y: 33 }, { x: 78, y: 47 }, { x: 87, y: 67 }] },
  { name: "Orion", family: "cross", minimum: 8, points: [{ x: 25, y: 25 }, { x: 75, y: 25 }, { x: 20, y: 68 }, { x: 80, y: 68 }, { x: 40, y: 42 }, { x: 50, y: 51 }, { x: 60, y: 42 }, { x: 50, y: 78 }] },
  { name: "Kreuz des Südens", family: "cross", minimum: 5, points: [{ x: 50, y: 16 }, { x: 50, y: 84 }, { x: 22, y: 50 }, { x: 78, y: 50 }, { x: 50, y: 50 }] },
  { name: "Pegasus", family: "cross", minimum: 8, points: [{ x: 22, y: 28 }, { x: 72, y: 22 }, { x: 82, y: 68 }, { x: 30, y: 76 }, { x: 45, y: 38 }, { x: 58, y: 50 }, { x: 38, y: 60 }, { x: 68, y: 62 }] },
];

function topologyTemplate(nodes: HouseholdDevice[]): { name: string; positions: Map<string, Point> } {
  const degrees = new Map(nodes.map((node) => [node.id, 0]));
  nodes.forEach((node) => { if (node.parent_id !== null) degrees.set(node.parent_id, (degrees.get(node.parent_id) ?? 0) + 1); });
  const root = nodes.find((node) => node.parent_id === null) ?? nodes[0];
  const hubDegree = root ? degrees.get(root.id) ?? 0 : 0;
  if (root && hubDegree >= 4 && nodes.length > 8) {
    const positions = new Map<string, Point>([[root.name, { x: 50, y: 50 }]]);
    const children = nodes.filter((node) => node.parent_id === root.id);
    children.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index / Math.max(1, children.length)) * Math.PI * 2;
      positions.set(node.name, { x: 50 + Math.cos(angle) * 31, y: 50 + Math.sin(angle) * 31 });
      nodes.filter((candidate) => candidate.parent_id === node.id).forEach((satellite, satelliteIndex, satellites) => {
        const satelliteAngle = angle + (satelliteIndex - (satellites.length - 1) / 2) * 0.35;
        positions.set(satellite.name, { x: 50 + Math.cos(satelliteAngle) * 43, y: 50 + Math.sin(satelliteAngle) * 43 });
      });
    });
    nodes.filter((node) => !positions.has(node.name)).forEach((node, index, remaining) => {
      const angle = (index / Math.max(1, remaining.length)) * Math.PI * 2;
      positions.set(node.name, { x: 50 + Math.cos(angle) * 20, y: 50 + Math.sin(angle) * 20 });
    });
    return { name: "Raffael-Zentralstern", positions };
  }
  const family = hubDegree >= 4 ? "hub" : nodes.length >= 8 ? "cross" : "chain";
  const candidates = CONSTELLATION_TEMPLATES.filter((item) => item.family === family && item.minimum <= nodes.length);
  const fingerprint = nodes.reduce((sum, node) => sum + node.name.split("").reduce((value, char) => value + char.charCodeAt(0), 0), 0);
  const template = candidates.length ? candidates[fingerprint % candidates.length] : { name: "Raffael-Muster", points: [] };
  const ordered: HouseholdDevice[] = [];
  if (root) ordered.push(root);
  for (const node of nodes) if (node !== root && !ordered.includes(node)) ordered.push(node);
  const positions = new Map<string, Point>();
  template.points.forEach((point, index) => { if (ordered[index]) positions.set(ordered[index].name, point); });
  return { name: template.name, positions };
}

export function Dashboard({ states, selectedKey, onSelect }: DashboardProps) {
  const summary = summarizeStates(states);
  const selected = states.find((state) => stateKey(state) === selectedKey) ?? states[0] ?? null;
  const healthRate = summary.total === 0 ? null : Math.round((summary.healthy / summary.total) * 100);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      const stored = window.localStorage.getItem(CONSTELLATION_STORAGE_KEY);
      return stored ? JSON.parse(stored) as Record<string, { x: number; y: number }> : {};
    } catch {
      return {};
    }
  });
  const [dragging, setDragging] = useState<string | null>(null);
  const [hasUnsavedLayout, setHasUnsavedLayout] = useState(false);
  const [showAddClient, setShowAddClient] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  const [showSourceImport, setShowSourceImport] = useState(false);
  const [discoveryMessage, setDiscoveryMessage] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<Array<{ address: string; hostname: string | null; open_ports: number[] }>>([]);
  const [addClientMessage, setAddClientMessage] = useState<string | null>(null);
  const [sourceImportMessage, setSourceImportMessage] = useState<string | null>(null);
  const [editingDevice, setEditingDevice] = useState<HouseholdDevice | null>(null);
  const [devices, setDevices] = useState<HouseholdDevice[]>([]);
  const [clients, setClients] = useState<HouseholdDevice[]>([]);
  const [checks, setChecks] = useState<CheckConfig[]>([]);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const managedDevices = devices.filter((device) => device.metadata.role !== "client");
  const draggedRef = useRef(false);

  useEffect(() => {
    if (!hasUnsavedLayout) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [hasUnsavedLayout]);

  useEffect(() => {
    void refreshDevices();
  }, [showAddClient]);

  async function refreshDevices() {
    try {
      const [deviceResponse, clientResponse, checkResponse] = await Promise.all([
        fetch("/household/devices"),
        fetch("/household/clients"),
        fetch("/checks"),
      ]);
      setDevices(deviceResponse.ok ? await deviceResponse.json() as HouseholdDevice[] : []);
      setClients(clientResponse.ok ? await clientResponse.json() as HouseholdDevice[] : []);
      setChecks(checkResponse.ok ? await checkResponse.json() as CheckConfig[] : []);
    } catch {
      setDevices([]);
      setClients([]);
      setChecks([]);
    }
  }

  async function addMonitor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const type = String(form.get("type") || "http");
    const csrf = document.cookie.match(/(?:^|; )raffael_csrf=([^;]+)/)?.[1];
    const payload = {
      device_id: Number(form.get("device_id")),
      name: form.get("name"),
      type,
      url: type === "http" ? form.get("url") || null : null,
      host: type === "tcp" || type === "tcp_auto" ? form.get("host") || null : null,
      port: type === "tcp" ? Number(form.get("port")) : null,
      interval: Number(form.get("interval") || 30),
    };
    const response = await fetch("/checks", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}) },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { detail?: string } | null;
      setCheckMessage(detail?.detail || "could not add sensor");
      return;
    }
    setCheckMessage("sensor added");
    await refreshDevices();
    event.currentTarget.reset();
  }

  function positionFor(name: string, index: number, total = states.length): { x: number; y: number } {
    return positions[name] ?? constellation.positions.get(name) ?? constellationPosition(index, total);
  }

  function moveStar(event: ReactPointerEvent<HTMLButtonElement>, name: string) {
    if (!dragging || dragging !== name) return;
    const canvas = event.currentTarget.parentElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(5, Math.min(95, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(14, Math.min(86, ((event.clientY - rect.top) / rect.height) * 100));
    draggedRef.current = true;
    setPositions((current) => {
      const next = { ...current, [name]: { x, y } };
      window.localStorage.setItem(CONSTELLATION_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setHasUnsavedLayout(true);
  }

  async function addClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const csrf = document.cookie.match(/(?:^|; )raffael_csrf=([^;]+)/)?.[1];
    const response = await fetch("/household/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}) },
      body: JSON.stringify({
        connector: form.get("connector") || "icmp",
        name: form.get("name"),
        endpoint: form.get("endpoint") || null,
        mac_address: form.get("mac_address") || null,
        parent_id: form.get("parent_id") ? Number(form.get("parent_id")) : null,
      }),
    });
    if (!response.ok) {
      setAddClientMessage("could not add client");
      return;
    }
    setAddClientMessage("client added");
    const created = await response.json() as HouseholdDevice;
    setDevices((current) => [...current, created]);
    setClients((current) => [...current, created]);
    event.currentTarget.reset();
  }

  async function discover(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const csrf = document.cookie.match(/(?:^|; )raffael_csrf=([^;]+)/)?.[1];
    const response = await fetch("/household/discover", { method: "POST", headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}) }, body: JSON.stringify({ network: form.get("network"), workers: 32 }) });
    if (!response.ok) { setDiscoveryMessage("discovery failed"); return; }
    const results = await response.json() as Array<{ address: string; hostname: string | null; open_ports: number[] }>;
    setDiscovered(results);
    setDiscoveryMessage(`${results.length} devices found`);
  }

  async function adopt(item: { address: string; hostname: string | null; open_ports: number[] }) {
    const csrf = document.cookie.match(/(?:^|; )raffael_csrf=([^;]+)/)?.[1];
    const response = await fetch("/household/discover/adopt", { method: "POST", headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}) }, body: JSON.stringify(item) });
    if (!response.ok) { setDiscoveryMessage("could not add device"); return; }
    const created = await response.json() as HouseholdDevice;
    setDevices((current) => [...current, created]);
    setClients((current) => [...current, created]);
    setDiscovered((current) => current.filter((candidate) => candidate.address !== item.address));
    setDiscoveryMessage("device added");
  }

  async function importClientsFromSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSourceImportMessage("importing clients");
    const form = new FormData(event.currentTarget);
    const source = String(form.get("source") || "unifi");
    const parentId = form.get("parent_id");
    const params = new URLSearchParams();
    if (parentId) params.set("parent_id", String(parentId));
    const csrf = document.cookie.match(/(?:^|; )raffael_csrf=([^;]+)/)?.[1];
    const config = source === "unifi" ? {
      url: form.get("url") || undefined,
      site: form.get("site") || undefined,
      console_id: form.get("console_id") || undefined,
      username: form.get("username") || undefined,
      password: form.get("password") || undefined,
      api_key: form.get("api_key") || undefined,
    } : undefined;
    const response = await fetch(`/integrations/${source}/clients/import${params.size ? `?${params.toString()}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}) },
      body: JSON.stringify(config || {}),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { detail?: string } | null;
      setSourceImportMessage(detail?.detail || "client import failed");
      return;
    }
    const result = await response.json() as { created: number; updated: number };
    await refreshDevices();
    setSourceImportMessage(`${result.created} added, ${result.updated} updated`);
  }

  async function renameDevice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingDevice) return;
    const form = new FormData(event.currentTarget);
    const csrf = document.cookie.match(/(?:^|; )raffael_csrf=([^;]+)/)?.[1];
    const response = await fetch(`/household/devices/${editingDevice.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}) }, body: JSON.stringify({ name: form.get("name") }) });
    if (!response.ok) return;
    const updated = await response.json() as HouseholdDevice;
    setDevices((current) => current.map((device) => device.id === updated.id ? updated : device));
    setClients((current) => current.map((device) => device.id === updated.id ? updated : device));
    setEditingDevice(null);
  }

  function parentName(parentId: number | null): string {
    if (parentId === null) return "root";
    return devices.find((device) => device.id === parentId)?.name ?? `#${parentId}`;
  }

  const stateByName = new Map(states.map((state) => [state.name, state]));
  const sensorsByDevice = new Map<number, ServiceState[]>();
  for (const state of states) {
    if (state.device_id === null) continue;
    const bucket = sensorsByDevice.get(state.device_id) ?? [];
    bucket.push(state);
    sensorsByDevice.set(state.device_id, bucket);
  }
  const constellationNodes: HouseholdDevice[] = devices.length
    ? devices
    : states.map((state, index) => ({ id: -(index + 1), name: state.name, connector: "", endpoint: null, parent_id: null, metadata: {}, status: "" } as HouseholdDevice));
  const constellation = topologyTemplate(constellationNodes);
  const selectedDevice = selected?.device_id !== null && selected?.device_id !== undefined
    ? devices.find((device) => device.id === selected.device_id) ?? null
    : null;
  const selectedSensors = selectedDevice
    ? sensorsByDevice.get(selectedDevice.id) ?? []
    : selected
      ? [selected]
      : [];
  const selectedLatencies = selectedSensors.map((sensor) => sensor.latency_ms).filter((value): value is number => value !== null);
  const selectedAverageLatency = average(selectedLatencies);

  return (
    <div className="shell">
      <aside className="rail" aria-label="Raffael navigation">
        <Logo />
        <div className="rail-line" />
        <div className="rail-item rail-item-active" aria-hidden="true">01</div>
        <div className="rail-spacer" />
        <div className="rail-version">0.6</div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <Logo withName className="workspace-logo" />
            <p className="eyebrow">raffael / operations</p>
            <h1>system overview</h1>
          </div>
          <div className="topbar-actions">
            <button className="add-client-button" type="button" aria-label="discover network" onClick={() => setShowDiscover(true)}>⌁</button>
            <button className="add-client-button" type="button" aria-label="add client" onClick={() => setShowAddClient(true)}>+</button>
            <div className="live-indicator"><span /> monitoring</div>
          </div>
        </header>

        <section className="summary" aria-label="Current status summary">
          <div className="summary-total">
            <strong>{summary.total}</strong>
            <span>sensors</span>
          </div>
          {summaryOrder.map((tone) => (
            <div className={`summary-item tone-${tone}`} key={tone}>
              <span className="status-dot" />
              <span>{tone}</span>
              <strong>{summary[tone]}</strong>
            </div>
          ))}
        </section>

        <section className="widget-strip" aria-label="Monitoring overview">
          <article className="metric-widget metric-widget-wide">
            <div className="widget-label">monitoring posture</div>
            <div className="widget-value">{healthRate === null ? "—" : `${healthRate}%`}</div>
            <div className="widget-caption">healthy sensors</div>
            <div className="dot-meter" aria-hidden="true">
              {Array.from({ length: 20 }, (_, index) => <i className={healthRate !== null && index < Math.round(healthRate / 5) ? "is-on" : ""} key={index} />)}
            </div>
          </article>
          <article className="metric-widget">
            <div className="widget-label">attention</div>
            <div className={`widget-value ${summary.critical + summary.warning > 0 ? "is-alert" : ""}`}>{summary.critical + summary.warning}</div>
            <div className="widget-caption">warning or critical</div>
            <div className="signal-line" aria-hidden="true"><span /><span /><span /><span /><span /></div>
          </article>
          <article className="metric-widget">
            <div className="widget-label">last signal</div>
            <div className="widget-value widget-value-small">{selected ? presentState(selected).latency : "—"}</div>
            <div className="widget-caption">selected latency</div>
            <div className="widget-status-mark">{selected ? presentState(selected).label : "waiting"}</div>
          </article>
        </section>

        <div className="content-grid">
          <section className="overview-panel" aria-labelledby="overview-title">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">current state</p>
                <h2 id="overview-title">client constellation</h2>
              </div>
              <div className="panel-heading-actions"><button className="add-client-button" type="button" aria-label="add client" onClick={() => setShowAddClient(true)}>+</button></div>
            </div>
                <p className="topology-note">{constellation.name}: detected from known topology relationships.</p>

            {constellationNodes.length === 0 ? (
              <div className="empty-state">nothing configured yet.</div>
            ) : (
              <div className="star-grid">
                <svg className="topology-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {constellationNodes.filter((node) => node.parent_id !== null).map((node) => {
                    const parent = constellationNodes.find((candidate) => candidate.id === node.parent_id);
                    if (!parent) return null;
                    const from = positionFor(parent.name, constellationNodes.indexOf(parent), constellationNodes.length);
                    const to = positionFor(node.name, constellationNodes.indexOf(node), constellationNodes.length);
                    return <line key={`${parent.id}-${node.id}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
                  })}
                </svg>
                {constellationNodes.map((node, index) => {
                  const nodeSensors = sensorsByDevice.get(node.id) ?? [];
                  const state = primarySensor(nodeSensors) ?? stateByName.get(node.name);
                  const view = state
                    ? presentState(state)
                    : { tone: "pending" as const, label: "pending", latency: "—", uptime: "—", downtime: "—", avgLatency: "—", downEvents: "—" };
                  const selectedClass = selected && selected.device_id === node.id ? " is-selected" : "";
                  const position = positionFor(node.name, index, constellationNodes.length);
                  return (
                    <button
                      className={`star tone-${view.tone}${selectedClass}${dragging === node.name ? " is-dragging" : ""}`}
                      key={node.id}
                      type="button"
                      style={{ left: `${position.x}%`, top: `${position.y}%` }}
                      onClick={() => { if (draggedRef.current) { draggedRef.current = false; return; } if (state) onSelect(stateKey(state)); }}
                      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(node.name); draggedRef.current = false; }}
                      onPointerMove={(event) => moveStar(event, node.name)}
                      onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); setDragging(null); }}
                      onPointerCancel={() => setDragging(null)}
                      aria-label={`${node.name}: ${view.label}, ${view.latency}`}
                    >
                      <svg className="star-art" viewBox="0 0 100 100" aria-hidden="true">
                        <path d="M50 4v92M4 50h92M17.5 17.5l65 65M82.5 17.5l-65 65" />
                        <circle cx="50" cy="50" r="4" />
                      </svg>
                      <span className="star-inner">
                        <span className="star-name">{node.name}</span>
                        <span className="star-status"><span className="status-dot" />{view.label}{nodeSensors.length > 1 ? ` · ${nodeSensors.length}` : ""}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="detail-panel" aria-live="polite">
            {selected ? (() => {
              const view = presentState(selected);
              return (
                <>
                  <div className="detail-head">
                    <div>
                      <p className="section-kicker">selected device</p>
                      <h2>{selectedDevice?.name ?? selected.name}</h2>
                    </div>
                    <span className={`status-pill tone-${view.tone}`}><span className="status-dot" />{view.label}</span>
                  </div>

                  <div className="latency-block">
                    <span>{selectedDevice ? "device latency average" : "latency now"}</span>
                    <strong>{selectedAverageLatency === null ? view.latency : `${selectedAverageLatency} ms`}</strong>
                    <small>{selectedSensors.length} sensor{selectedSensors.length === 1 ? "" : "s"} under this star.</small>
                  </div>

                  <dl className="detail-list">
                    <div>
                      <dt>uptime</dt>
                      <dd>{view.uptime}</dd>
                    </div>
                    <div>
                      <dt>downtime</dt>
                      <dd>{view.downtime}</dd>
                    </div>
                    <div>
                      <dt>avg latency</dt>
                      <dd>{view.avgLatency}</dd>
                    </div>
                    <div>
                      <dt>down events</dt>
                      <dd>{view.downEvents}</dd>
                    </div>
                    {selected.details ? Object.entries(selected.details).slice(0, 6).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key.replaceAll("_", " ")}</dt>
                        <dd>{detailValue(value)}</dd>
                      </div>
                    )) : null}
                    <div>
                      <dt>last checked</dt>
                      <dd>{checkedLabel(selected.last_checked)}</dd>
                    </div>
                    <div>
                      <dt>response</dt>
                      <dd>{selected.http_status === null ? "not http" : `http ${selected.http_status}`}</dd>
                    </div>
                    <div>
                      <dt>success streak</dt>
                      <dd>{selected.consecutive_successes}</dd>
                    </div>
                    <div>
                      <dt>failure streak</dt>
                      <dd>{selected.consecutive_failures}</dd>
                    </div>
                  </dl>

                  <div className="detail-error">
                    <span>last error</span>
                    <p>{selected.error ?? "none"}</p>
                  </div>

                  <div className="clients-table" role="table" aria-label="Device sensors">
                    <div className="clients-row clients-row-head" role="row"><span role="columnheader">sensor</span><span role="columnheader">status</span><span role="columnheader">latency</span><span role="columnheader">uptime</span><span role="columnheader">target</span></div>
                    {selectedSensors.map((sensor) => {
                      const sensorView = presentState(sensor);
                      const target = sensor.details?.target ?? sensor.details?.host ?? (sensor.http_status === null ? "tcp" : "http");
                      return (
                        <div className="clients-row" role="row" key={stateKey(sensor)}>
                          <strong role="cell">{sensor.name}</strong>
                          <span role="cell">{sensorView.label}</span>
                          <span role="cell">{sensorView.latency}</span>
                          <span role="cell">{sensorView.uptime}</span>
                          <span role="cell">{detailValue(target)}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })() : (
              <div className="empty-state">select something once it exists.</div>
            )}
          </aside>
        </div>

        <section className="cluster-section" aria-labelledby="clusters-title">
          <div className="panel-heading">
            <div><p className="section-kicker">real service groups</p><h2 id="clusters-title">clusters</h2></div>
            <span className="panel-meta">derived from current status</span>
          </div>
          <div className="cluster-grid">
            {summaryOrder.map((tone) => {
              const members = states.filter((state) => presentState(state).tone === tone);
              return <article className={`cluster-card tone-${tone}`} key={tone}>
                <div className="cluster-title"><span className="status-dot" />{tone}<strong>{members.length}</strong></div>
                <div className="cluster-members">{members.length ? members.map((member) => <button type="button" key={stateKey(member)} onClick={() => onSelect(stateKey(member))}>{member.name}</button>) : <span>none</span>}</div>
              </article>;
            })}
          </div>
        </section>

        <section className="clients-section sensors-section" aria-labelledby="checks-title">
          <div className="panel-heading">
            <div><p className="section-kicker">active checks</p><h2 id="checks-title">sensors</h2></div>
            <span className="panel-meta">{checks.length} saved</span>
          </div>
          <form className="monitor-form" onSubmit={addMonitor}>
            <label><span>device</span><select name="device_id" aria-label="device" required><option value="">choose device</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label>
            <label><span>name</span><input name="name" aria-label="sensor name" placeholder="sensor name" required /></label>
            <label><span>type</span><select name="type" aria-label="type" defaultValue="http"><option value="http">http</option><option value="tcp">tcp</option><option value="tcp_auto">auto tcp</option></select></label>
            <label className="monitor-form-wide"><span>http</span><input name="url" aria-label="http url" placeholder="https://host/health" /></label>
            <label><span>host</span><input name="host" aria-label="tcp host" placeholder="tcp host" /></label>
            <label><span>port</span><input name="port" aria-label="tcp port" type="number" min="1" max="65535" placeholder="port" /></label>
            <label><span>interval</span><input name="interval" aria-label="interval seconds" type="number" min="1" defaultValue="30" /></label>
            <button className="monitor-form-submit" type="submit" aria-label="add sensor"><span>+</span><strong>add sensor</strong></button>
          </form>
          {checkMessage ? <p className="client-dialog-message" role="status">{checkMessage}</p> : null}
          {checks.length === 0 ? <div className="clients-empty">no sensors saved yet.</div> : (
            <div className="clients-table" role="table" aria-label="Saved sensors">
              <div className="clients-row clients-row-head" role="row"><span role="columnheader">name</span><span role="columnheader">device</span><span role="columnheader">target</span><span role="columnheader">type</span><span role="columnheader">interval</span></div>
              {checks.map((check) => <div className="clients-row" role="row" key={check.id}><strong role="cell">{check.name}</strong><span role="cell">{devices.find((device) => device.id === check.device_id)?.name ?? `#${check.device_id}`}</span><span role="cell">{check.type === "http" ? check.url : check.type === "tcp_auto" ? `${check.host}:auto` : `${check.host}:${check.port}`}</span><span role="cell">{check.type}</span><span role="cell">{check.interval}s</span></div>)}
            </div>
          )}
        </section>

        <section className="clients-section" aria-labelledby="clients-title">
          <div className="panel-heading">
            <div><p className="section-kicker">network inventory</p><h2 id="clients-title">clients</h2></div>
            <div className="panel-heading-actions">
              <span className="panel-meta">{clients.length} saved</span>
              <button className="source-import-button" type="button" onClick={() => setShowSourceImport(true)}>import source</button>
              <button className="add-client-button" type="button" aria-label="add client" onClick={() => setShowAddClient(true)}>+</button>
            </div>
          </div>
          {clients.length === 0 ? (
            <div className="clients-empty">no clients saved yet.</div>
          ) : (
            <div className="clients-table" role="table" aria-label="Saved clients">
              <div className="clients-row clients-row-head" role="row">
                <span role="columnheader">name</span>
                <span role="columnheader">endpoint</span>
                <span role="columnheader">parent</span>
                <span role="columnheader">connector</span>
                <span role="columnheader">mac</span>
              </div>
              {clients.map((client) => (
                <div className="clients-row" role="row" key={client.id}>
                  <strong role="cell">{client.name}</strong>
                  <span role="cell">{client.endpoint || "not set"}</span>
                  <span role="cell">{parentName(client.parent_id)}</span>
                  <span role="cell">{client.connector}</span>
                  <span role="cell">{String(client.metadata.mac_address || "not set")} <button type="button" className="device-edit-button" onClick={() => setEditingDevice(client)} aria-label={`edit ${client.name}`}>edit</button></span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="clients-section" aria-labelledby="devices-title">
          <div className="panel-heading">
            <div><p className="section-kicker">website-managed inventory</p><h2 id="devices-title">devices & services</h2></div>
            <span className="panel-meta">{managedDevices.length} saved</span>
          </div>
          {managedDevices.length === 0 ? <div className="clients-empty">no infrastructure saved yet.</div> : (
            <div className="clients-table" role="table" aria-label="Managed devices and services">
              <div className="clients-row clients-row-head" role="row"><span role="columnheader">name</span><span role="columnheader">endpoint</span><span role="columnheader">parent</span><span role="columnheader">connector</span><span role="columnheader">status</span></div>
              {managedDevices.map((device) => <div className="clients-row" role="row" key={device.id}><strong role="cell">{device.name}</strong><span role="cell">{device.endpoint || "not set"}</span><span role="cell">{parentName(device.parent_id)}</span><span role="cell">{device.connector}</span><span role="cell">{device.status} <button type="button" className="device-edit-button" onClick={() => setEditingDevice(device)} aria-label={`edit ${device.name}`}>edit</button></span></div>)}
            </div>
          )}
        </section>

        <footer className="workspace-footnote">raffael · local infrastructure · v0.6</footer>

        {showAddClient ? (
          <div className="client-dialog-backdrop" role="presentation" onClick={() => setShowAddClient(false)}>
            <section className="client-dialog" role="dialog" aria-modal="true" aria-labelledby="add-client-title" onClick={(event) => event.stopPropagation()}>
              <button className="client-dialog-close" type="button" aria-label="close" onClick={() => setShowAddClient(false)}>×</button>
              <p className="section-kicker">raffael / clients</p>
              <h2 id="add-client-title">new client</h2>
              <form className="client-dialog-form" onSubmit={addClient}>
                <label><span className="sr-only">name</span><input name="name" aria-label="name" placeholder="name" autoFocus required /></label>
                <label><span className="sr-only">endpoint</span><input name="endpoint" aria-label="ip or hostname" placeholder="ip or hostname" /></label>
                <label><span className="sr-only">mac address</span><input name="mac_address" aria-label="mac address" placeholder="mac address (optional)" /></label>
                <label><span className="sr-only">connector</span><select name="connector" aria-label="connector" defaultValue="icmp"><option value="icmp">ping / network</option><option value="generic">generic service</option><option value="snmp">SNMP</option><option value="unifi">unifi</option><option value="hue">philips hue</option><option value="proxmox">proxmox</option><option value="docker">docker</option><option value="ssh">SSH Linux</option><option value="windows-agent">windows</option><option value="macos-agent">macos</option></select></label>
                <label><span className="sr-only">parent device</span><select name="parent_id" aria-label="parent device" defaultValue=""><option value="">no parent (root device)</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.connector}</option>)}</select></label>
                <button className="client-dialog-submit" type="submit"><span>+</span> add client</button>
                {addClientMessage ? <p className="client-dialog-message" role="status">{addClientMessage}</p> : null}
              </form>
            </section>
          </div>
        ) : null}
        {showDiscover ? (
          <div className="client-dialog-backdrop" role="presentation" onClick={() => setShowDiscover(false)}>
            <section className="client-dialog" role="dialog" aria-modal="true" aria-labelledby="discover-title" onClick={(event) => event.stopPropagation()}>
              <button className="client-dialog-close" type="button" aria-label="close" onClick={() => setShowDiscover(false)}>×</button>
              <p className="section-kicker">raffael / discovery</p><h2 id="discover-title">scan network</h2>
              <form className="client-dialog-form" onSubmit={discover}><label><span className="sr-only">network</span><input name="network" aria-label="network" placeholder="private network cidr" required /></label><button className="client-dialog-submit" type="submit">scan</button></form>
              {discoveryMessage ? <p className="client-dialog-message" role="status">{discoveryMessage}</p> : null}
              {discovered.length ? <div className="cluster-members">{discovered.map((item) => <span key={item.address}>{item.hostname || item.address}{item.open_ports.length ? ` · ${item.open_ports.join(", ")}` : ""}<button type="button" onClick={() => adopt(item)} aria-label={`add ${item.address}`}>+</button></span>)}</div> : null}
            </section>
          </div>
        ) : null}
        {showSourceImport ? (
          <div className="client-dialog-backdrop" role="presentation" onClick={() => setShowSourceImport(false)}>
            <section className="client-dialog" role="dialog" aria-modal="true" aria-labelledby="source-import-title" onClick={(event) => event.stopPropagation()}>
              <button className="client-dialog-close" type="button" aria-label="close" onClick={() => setShowSourceImport(false)}>×</button>
              <p className="section-kicker">raffael / sources</p>
              <h2 id="source-import-title">import clients</h2>
              <form className="client-dialog-form" onSubmit={importClientsFromSource}>
                <label><span className="sr-only">source</span><select name="source" aria-label="source" defaultValue="unifi"><option value="unifi">unifi network</option><option value="api">generic api</option><option value="snmp">snmp targets</option><option value="demo">Raffael test inventory</option></select></label>
                <label><span className="sr-only">UniFi URL</span><input name="url" aria-label="UniFi URL" placeholder="https://unifi.local" /></label>
                <label><span className="sr-only">UniFi site</span><input name="site" aria-label="UniFi site" placeholder="default" defaultValue="default" /></label>
                <label><span className="sr-only">UniFi API key</span><input name="api_key" aria-label="UniFi API key" type="password" placeholder="API key (optional)" /></label>
                <p className="client-dialog-message">Raffael erkennt lokale UniFi-API und Site automatisch.</p>
                <label><span className="sr-only">UniFi username</span><input name="username" aria-label="UniFi username" placeholder="username (optional)" /></label>
                <label><span className="sr-only">UniFi password</span><input name="password" aria-label="UniFi password" type="password" placeholder="password (optional)" /></label>
                <label><span className="sr-only">parent device</span><select name="parent_id" aria-label="parent device" defaultValue=""><option value="">no parent (root clients)</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.connector}</option>)}</select></label>
                <button className="client-dialog-submit" type="submit"><span>in</span> import clients</button>
                {sourceImportMessage ? <p className="client-dialog-message" role="status">{sourceImportMessage}</p> : null}
              </form>
            </section>
          </div>
        ) : null}
        {editingDevice ? (
          <div className="client-dialog-backdrop" role="presentation" onClick={() => setEditingDevice(null)}>
            <section className="client-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-device-title" onClick={(event) => event.stopPropagation()}>
              <button className="client-dialog-close" type="button" aria-label="close" onClick={() => setEditingDevice(null)}>×</button>
              <p className="section-kicker">raffael / device</p><h2 id="edit-device-title">edit name</h2>
              <form className="client-dialog-form" onSubmit={renameDevice}><label><span className="sr-only">name</span><input name="name" aria-label="name" defaultValue={editingDevice.name} autoFocus required /></label><button className="client-dialog-submit" type="submit"><span>save</span> name</button></form>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
