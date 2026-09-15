import socket
from dataclasses import dataclass
from time import perf_counter
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import Service


@dataclass(frozen=True)
class CheckResult:
    name: str
    url: str
    status: str
    latency_ms: int | None
    http_status: int | None
    error: str | None = None
    kind: str = "http"
    details: dict[str, str | int | float | bool | None] | None = None


def check_http(service: Service) -> CheckResult:
    if not service.url:
        raise ValueError("http check needs a url")

    started = perf_counter()
    request = Request(service.url, headers={"User-Agent": "raffael/0.6"})

    try:
        with urlopen(request, timeout=service.timeout) as response:
            latency = round((perf_counter() - started) * 1000)
            code = response.status
            return CheckResult(
                service.name,
                service.url,
                "up" if 200 <= code < 400 else "down",
                latency,
                code,
                details={"target": service.url, "check_type": "http", "http_status": code},
            )
    except HTTPError as exc:
        latency = round((perf_counter() - started) * 1000)
        return CheckResult(
            service.name,
            service.url,
            "down",
            latency,
            exc.code,
            str(exc.reason),
            details={"target": service.url, "check_type": "http", "http_status": exc.code},
        )
    except (URLError, TimeoutError, OSError) as exc:
        return CheckResult(
            service.name,
            service.url,
            "down",
            None,
            None,
            str(getattr(exc, "reason", exc)),
            details={"target": service.url, "check_type": "http"},
        )


def check_tcp(service: Service) -> CheckResult:
    if not service.host or service.port is None:
        raise ValueError("tcp check needs a host and port")

    target = f"{service.host}:{service.port}"
    started = perf_counter()
    try:
        with socket.create_connection((service.host, service.port), timeout=service.timeout):
            latency = round((perf_counter() - started) * 1000)
            return CheckResult(
                service.name,
                target,
                "up",
                latency,
                None,
                kind="tcp",
                details={"target": target, "check_type": "tcp", "host": service.host, "port": service.port},
            )
    except (TimeoutError, OSError) as exc:
        return CheckResult(
            service.name,
            target,
            "down",
            None,
            None,
            str(exc),
            kind="tcp",
            details={"target": target, "check_type": "tcp", "host": service.host, "port": service.port},
        )


def check_tcp_auto(service: Service) -> CheckResult:
    if not service.host:
        raise ValueError("tcp auto check needs a host")

    errors: list[str] = []
    for port in service.probe_ports:
        probe = Service(
            name=service.name,
            type="tcp",
            host=service.host,
            port=port,
            timeout=service.timeout,
        )
        result = check_tcp(probe)
        if result.status == "up":
            return CheckResult(
                service.name,
                f"{service.host}:{port}",
                "up",
                result.latency_ms,
                None,
                kind="tcp_auto",
                details={
                    "target": f"{service.host}:{port}",
                    "check_type": "tcp_auto",
                    "host": service.host,
                    "open_port": port,
                    "probe_ports": ",".join(str(item) for item in service.probe_ports),
                },
            )
        if result.error:
            errors.append(f"{port}: {result.error}")
    return CheckResult(
        service.name,
        service.host,
        "down",
        None,
        None,
        "; ".join(errors[:3]) or "no open tcp probe ports",
        kind="tcp_auto",
        details={
            "target": service.host,
            "check_type": "tcp_auto",
            "host": service.host,
            "probe_ports": ",".join(str(item) for item in service.probe_ports),
        },
    )


def check_service(service: Service) -> CheckResult:
    if service.type == "tcp_auto":
        return check_tcp_auto(service)
    if service.type == "tcp":
        return check_tcp(service)
    if service.type == "http":
        return check_http(service)
    raise ValueError(f"don't know how to check {service.type}")
