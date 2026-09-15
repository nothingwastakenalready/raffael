import os
import ipaddress
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from fastapi import Cookie, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

from .checks import CheckResult, check_service
from .config import Service, load_services
from .engine import MonitoringEngine
from .history import HistoryStore, SqlAlchemyHistoryStore
from .auth import AuthStore, CSRF_COOKIE, SESSION_COOKIE
from .client_sources import ClientSourceError, ImportedClient, fetch_api_clients, fetch_snmp_clients
from .email_templates import confirmation_email, newsletter_confirmation_email, password_reset_email
from .households import DeviceStore, connector_catalog
from .connectors import discover_network
from .mailer import SmtpMailer
from .unifi import fetch_unifi_clients
from .monitors import CheckStore, CompositeRecorder

Checker = Callable[[Service], CheckResult]
ClientSourceLoader = Callable[[], list[ImportedClient]]


class ServiceInput(BaseModel):
    name: str
    type: str = "http"
    url: str | None = None
    host: str | None = None
    port: int | None = None
    timeout: float = 2.0

    @model_validator(mode="after")
    def validate_target(self):
        self.type = self.type.lower()
        if self.type == "http" and not self.url:
            raise ValueError("http checks need a url")
        if self.type == "tcp" and (not self.host or self.port is None):
            raise ValueError("tcp checks need a host and port")
        if self.type not in {"http", "tcp"}:
            raise ValueError(f"don't know how to check {self.type}")
        return self

    def service(self) -> Service:
        return Service(name=self.name, type=self.type, url=self.url, host=self.host, port=self.port, timeout=self.timeout)


class AccountInput(BaseModel):
    email: str
    password: str
    workspace_name: str = "default"
    newsletter_opt_in: bool = False


class PasswordResetRequest(BaseModel):
    email: str


class PasswordResetConfirm(BaseModel):
    token: str
    password: str


class DeviceInput(BaseModel):
    connector: str
    name: str
    endpoint: str | None = None
    credential_ref: str | None = None
    metadata: dict = Field(default_factory=dict)
    parent_id: int | None = None


class DeviceRenameInput(BaseModel):
    name: str


class CheckInput(BaseModel):
    device_id: int
    name: str
    type: str = "http"
    url: str | None = None
    host: str | None = None
    port: int | None = None
    interval: float = 30.0
    timeout: float = 2.0
    failure_threshold: int = 2
    success_threshold: int = 1
    active: bool = True


class CheckPatchInput(BaseModel):
    device_id: int | None = None
    name: str | None = None
    type: str | None = None
    url: str | None = None
    host: str | None = None
    port: int | None = None
    interval: float | None = None
    timeout: float | None = None
    failure_threshold: int | None = None
    success_threshold: int | None = None
    active: bool | None = None


class ClientInput(BaseModel):
    name: str
    endpoint: str | None = None
    mac_address: str | None = None
    connector: str = "icmp"
    parent_id: int | None = None
    metadata: dict = Field(default_factory=dict)


class IntegrationImportInput(BaseModel):
    url: str | None = None
    site: str | None = None
    console_id: str | None = None
    username: str | None = None
    password: str | None = None
    api_key: str | None = None


class DiscoveryInput(BaseModel):
    network: str = Field(pattern=r"^\d{1,3}(?:\.\d{1,3}){3}/\d{1,2}$")
    workers: int = Field(default=32, ge=1, le=128)


class DiscoveryAdoptInput(BaseModel):
    address: str
    hostname: str | None = None
    open_ports: list[int] = Field(default_factory=list)
    parent_id: int | None = None


def result_json(result: CheckResult) -> dict:
    data = asdict(result)
    data["type"] = data.pop("kind")
    data.pop("url", None)
    return data


def create_app(
    config_path: str | Path | None = None,
    checker: Checker = check_service,
    engine: MonitoringEngine | None = None,
    monitor: bool = False,
    ui_path: str | Path | None = None,
    history: HistoryStore | None = None,
    database_url: str | None = None,
    mailer: SmtpMailer | None = None,
    client_source_loaders: dict[str, ClientSourceLoader] | None = None,
    unifi_client_loader: ClientSourceLoader | None = None,
) -> FastAPI:
    path = Path(config_path or os.environ.get("RAFFAEL_CONFIG", "/config/services.yaml"))
    runtime_engine = engine
    runtime_history = history
    runtime_auth: AuthStore | None = None
    runtime_devices: DeviceStore | None = None
    runtime_checks: CheckStore | None = None
    rate_buckets: dict[tuple[str, str], list[datetime]] = {}
    runtime_mailer = mailer or SmtpMailer()
    runtime_client_source_loaders = {
        "unifi": unifi_client_loader or fetch_unifi_clients,
        "api": fetch_api_clients,
        "snmp": fetch_snmp_clients,
    }
    if client_source_loaders:
        runtime_client_source_loaders.update(client_source_loaders)
    ui_root = Path(ui_path or os.environ.get("RAFFAEL_UI", "/app/web/dist"))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        nonlocal runtime_engine, runtime_history, runtime_auth, runtime_devices, runtime_checks
        owns_history = False
        if runtime_history is None and monitor:
            runtime_history = SqlAlchemyHistoryStore(
                database_url
                or os.environ.get("RAFFAEL_DATABASE_URL", "sqlite:////data/raffael.db")
            )
            runtime_history.initialize()
            owns_history = True
        if runtime_auth is None and (database_url or monitor):
            runtime_auth = AuthStore(database_url or os.environ.get("RAFFAEL_DATABASE_URL", "sqlite:////data/raffael.db"))
            runtime_auth.initialize()
        if runtime_auth is not None:
            runtime_devices = DeviceStore(runtime_auth.engine)
            runtime_checks = CheckStore(runtime_auth.engine)
            runtime_checks.ensure_default_checks()
        if runtime_engine is None and monitor:
            services = runtime_checks.active_services() if runtime_checks is not None else load_services(path)
            recorder = CompositeRecorder(runtime_history, runtime_checks) if runtime_checks is not None else runtime_history
            runtime_engine = MonitoringEngine(
                services, checker=checker, history=recorder
            )
        app.state.engine = runtime_engine
        app.state.history = runtime_history
        app.state.auth = runtime_auth
        app.state.devices = runtime_devices
        app.state.checks = runtime_checks
        if runtime_engine is not None:
            await runtime_engine.start()
        try:
            yield
        finally:
            if runtime_engine is not None:
                await runtime_engine.stop()
            if owns_history and runtime_history is not None:
                runtime_history.close()
            if runtime_auth is not None:
                runtime_auth.close()

    app = FastAPI(title="raffael", version="0.6.0", lifespan=lifespan)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        response.headers.setdefault("Cross-Origin-Embedder-Policy", "require-corp")
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; "
            "form-action 'self'; frame-ancestors 'none'",
        )
        response.headers.setdefault("Cache-Control", "no-store")
        return response

    def refresh_engine_services() -> None:
        if runtime_engine is None or runtime_checks is None:
            return
        import asyncio
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            asyncio.run(runtime_engine.replace_services(runtime_checks.active_services()))
        else:
            loop.create_task(runtime_engine.replace_services(runtime_checks.active_services()))

    def create_default_check(workspace_id: int, device: dict) -> None:
        if runtime_checks is None:
            return
        if runtime_checks.create_for_device_target(workspace_id, device) is not None:
            refresh_engine_services()

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/ready")
    def ready():
        checks_ready = runtime_checks is not None
        history_ready = runtime_history is not None
        scheduler_ready = runtime_engine is not None and bool(runtime_engine.states() or checks_ready)
        status = "ok" if checks_ready and history_ready and scheduler_ready else "degraded"
        return {
            "status": status,
            "database": "ok" if checks_ready and history_ready else "unavailable",
            "scheduler": "ok" if scheduler_ready else "unavailable",
        }

    def require_authenticated_user(session_token: str | None) -> object:
        if runtime_auth is None:
            return None
        user = runtime_auth.user_for_token(session_token)
        if user is None:
            raise HTTPException(status_code=401, detail="authentication required")
        return user

    def current_workspace(session_token: str | None) -> tuple[object, int]:
        user = require_authenticated_user(session_token)
        if runtime_auth is None or user is None:
            raise HTTPException(status_code=503, detail="authentication storage unavailable")
        memberships = runtime_auth.memberships(user.id)
        if not memberships:
            raise HTTPException(status_code=403, detail="workspace membership required")
        return user, int(memberships[0]["id"])

    def require_csrf(session_token: str | None, csrf: str | None) -> None:
        if runtime_auth is None or not session_token or not runtime_auth.csrf_valid(session_token, csrf):
            raise HTTPException(status_code=403, detail="csrf validation failed")

    def require_write_guard(request: Request, session_token: str | None, csrf: str | None) -> None:
        require_csrf(session_token, csrf)
        origin = request.headers.get("origin")
        if not origin:
            return
        public_url = os.environ.get("RAFFAEL_PUBLIC_URL", "http://127.0.0.1:8080").rstrip("/")
        if not origin.startswith(public_url):
            raise HTTPException(status_code=403, detail="origin validation failed")

    def rate_limit(request: Request, key: str, limit: int, window_seconds: int) -> None:
        client = request.client.host if request.client else "unknown"
        bucket_key = (key, client)
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=window_seconds)
        bucket = [item for item in rate_buckets.get(bucket_key, []) if item > cutoff]
        if len(bucket) >= limit:
            raise HTTPException(status_code=429, detail="rate limit exceeded")
        bucket.append(now)
        rate_buckets[bucket_key] = bucket

    @app.post("/auth/register", status_code=201)
    def register(account: AccountInput, response: Response, request: Request):
        rate_limit(request, "register", 5, 3600)
        if runtime_auth is None:
            raise HTTPException(status_code=503, detail="authentication storage unavailable")
        try:
            user = runtime_auth.register(account.email, account.password, account.workspace_name)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        public_url = os.environ.get("RAFFAEL_PUBLIC_URL", "http://127.0.0.1:8080").rstrip("/")
        verification_token = runtime_auth.issue_token(user.id, "email_verification")
        email_logo_url = f"{public_url}/assets/02-logo-varianten/logo-liquid-silver-weiss-transparent.png"
        verification_message = confirmation_email(recipient=user.email, confirmation_url=f"{public_url}/auth/confirm?token={verification_token}", logo_url=email_logo_url)
        if runtime_mailer.enabled:
            runtime_mailer.send(user.email, verification_message)
        if account.newsletter_opt_in:
            newsletter_token = runtime_auth.start_newsletter(user.id, "i want to receive the raffael newsletter")
            newsletter_message = newsletter_confirmation_email(recipient=user.email, confirmation_url=f"{public_url}/auth/newsletter/confirm?token={newsletter_token}", logo_url=email_logo_url)
            if runtime_mailer.enabled:
                runtime_mailer.send(user.email, newsletter_message)
        token, csrf = runtime_auth.create_session(user.id)
        response.set_cookie(SESSION_COOKIE, token, httponly=True, secure=os.environ.get("RAFFAEL_SECURE_COOKIES", "0") == "1", samesite="lax", max_age=7 * 24 * 3600)
        response.set_cookie(CSRF_COOKIE, csrf, httponly=False, secure=os.environ.get("RAFFAEL_SECURE_COOKIES", "0") == "1", samesite="lax", max_age=7 * 24 * 3600)
        return {"id": user.id, "email": user.email, "email_verified": False, "workspaces": runtime_auth.memberships(user.id)}

    @app.get("/auth/confirm")
    def confirm_email(token: str):
        if runtime_auth is None or not runtime_auth.confirm_email(token):
            raise HTTPException(status_code=400, detail="invalid or expired confirmation token")
        return {"status": "confirmed"}

    @app.get("/auth/newsletter/confirm")
    def confirm_newsletter(token: str):
        if runtime_auth is None or not runtime_auth.confirm_newsletter(token):
            raise HTTPException(status_code=400, detail="invalid or expired newsletter token")
        return {"status": "subscribed"}

    @app.post("/auth/login")
    def login(account: AccountInput, response: Response, request: Request):
        rate_limit(request, "login", 20, 300)
        if runtime_auth is None:
            raise HTTPException(status_code=503, detail="authentication storage unavailable")
        user = runtime_auth.authenticate(account.email, account.password)
        if user is None:
            raise HTTPException(status_code=401, detail="invalid credentials")
        token, csrf = runtime_auth.create_session(user.id)
        response.set_cookie(SESSION_COOKIE, token, httponly=True, secure=os.environ.get("RAFFAEL_SECURE_COOKIES", "0") == "1", samesite="lax", max_age=7 * 24 * 3600)
        response.set_cookie(CSRF_COOKIE, csrf, httponly=False, secure=os.environ.get("RAFFAEL_SECURE_COOKIES", "0") == "1", samesite="lax", max_age=7 * 24 * 3600)
        return {"id": user.id, "email": user.email, "workspaces": runtime_auth.memberships(user.id)}

    @app.post("/auth/password-reset/request")
    def request_password_reset(account: PasswordResetRequest, request: Request):
        rate_limit(request, "password-reset", 5, 3600)
        if runtime_auth is None:
            raise HTTPException(status_code=503, detail="authentication storage unavailable")
        try:
            result = runtime_auth.request_password_reset(account.email)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if result is not None and runtime_mailer.enabled:
            user, token = result
            public_url = os.environ.get("RAFFAEL_PUBLIC_URL", "http://127.0.0.1:8080").rstrip("/")
            logo_url = f"{public_url}/assets/02-logo-varianten/logo-liquid-silver-weiss-transparent.png"
            message = password_reset_email(recipient=user.email, reset_url=f"{public_url}/#/reset?token={token}", logo_url=logo_url)
            runtime_mailer.send(user.email, message)
        return {"status": "accepted"}

    @app.post("/auth/password-reset/confirm")
    def confirm_password_reset(account: PasswordResetConfirm):
        if runtime_auth is None:
            raise HTTPException(status_code=503, detail="authentication storage unavailable")
        try:
            valid = runtime_auth.reset_password(account.token, account.password)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not valid:
            raise HTTPException(status_code=400, detail="invalid or expired reset token")
        return {"status": "updated"}

    @app.get("/auth/me")
    def current_user(session_token: str | None = Cookie(None, alias=SESSION_COOKIE)):
        if runtime_auth is None:
            raise HTTPException(status_code=503, detail="authentication storage unavailable")
        user = runtime_auth.user_for_token(session_token)
        if user is None:
            raise HTTPException(status_code=401, detail="authentication required")
        return {"id": user.id, "email": user.email, "workspaces": runtime_auth.memberships(user.id)}

    @app.post("/auth/logout", status_code=204)
    def logout(response: Response, request: Request, session_token: str | None = Cookie(None, alias=SESSION_COOKIE), csrf_token: str | None = Cookie(None, alias=CSRF_COOKIE), x_csrf_token: str | None = Header(None)):
        if runtime_auth is None:
            raise HTTPException(status_code=503, detail="authentication storage unavailable")
        require_write_guard(request, session_token, x_csrf_token)
        runtime_auth.revoke(session_token)
        response.delete_cookie(SESSION_COOKIE)
        response.delete_cookie(CSRF_COOKIE)

    @app.get("/services")
    def services(session_token: str | None = Cookie(None, alias=SESSION_COOKIE)):
        require_authenticated_user(session_token)
        return [result_json(checker(service)) for service in load_services(path)]

    @app.get("/checks")
    def checks(session_token: str | None = Cookie(None, alias=SESSION_COOKIE)):
        _, workspace_id = current_workspace(session_token)
        if runtime_checks is None:
            raise HTTPException(status_code=503, detail="check storage unavailable")
        return runtime_checks.list(workspace_id)

    @app.post("/checks", status_code=201)
    def add_check(
        request: Request,
        check: CheckInput,
        session_token: str | None = Cookie(None, alias=SESSION_COOKIE),
        x_csrf_token: str | None = Header(None),
    ):
        _, workspace_id = current_workspace(session_token)
        require_write_guard(request, session_token, x_csrf_token)
        if runtime_checks is None:
            raise HTTPException(status_code=503, detail="check storage unavailable")
        try:
            created = runtime_checks.create(workspace_id, check.model_dump())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        refresh_engine_services()
        return created

    @app.patch("/checks/{check_id}")
    def update_check(
        request: Request,
        check_id: int,
        check: CheckPatchInput,
        session_token: str | None = Cookie(None, alias=SESSION_COOKIE),
        x_csrf_token: str | None = Header(None),
    ):
        _, workspace_id = current_workspace(session_token)
        require_write_guard(request, session_token, x_csrf_token)
        if runtime_checks is None:
            raise HTTPException(status_code=503, detail="check storage unavailable")
        try:
            updated = runtime_checks.update(workspace_id, check_id, check.model_dump(exclude_none=True))
        except ValueError as exc:
            raise HTTPException(status_code=404 if "not found" in str(exc) else 400, detail=str(exc)) from exc
        refresh_engine_services()
        return updated

    @app.delete("/checks/{check_id}", status_code=204)
    def delete_check(
        request: Request,
        check_id: int,
        session_token: str | None = Cookie(None, alias=SESSION_COOKIE),
        x_csrf_token: str | None = Header(None),
    ):
        _, workspace_id = current_workspace(session_token)
        require_write_guard(request, session_token, x_csrf_token)
        if runtime_checks is None:
            raise HTTPException(status_code=503, detail="check storage unavailable")
        try:
            runtime_checks.delete(workspace_id, check_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        refresh_engine_services()

    @app.post("/checks/{check_id}/run")
    async def run_check(
        request: Request,
        check_id: int,
        session_token: str | None = Cookie(None, alias=SESSION_COOKIE),
        x_csrf_token: str | None = Header(None),
    ):
        _, workspace_id = current_workspace(session_token)
        require_write_guard(request, session_token, x_csrf_token)
        if runtime_checks is None or runtime_engine is None:
            raise HTTPException(status_code=503, detail="monitoring unavailable")
        try:
            runtime_checks.get(workspace_id, check_id)
            state = await runtime_engine.run_key_once(str(check_id))
        except (ValueError, KeyError) as exc:
            raise HTTPException(status_code=404, detail="check not found or inactive") from exc
        return asdict(state)

    @app.get("/checks/{check_id}/history")
    def check_history(
        check_id: int,
        start: datetime | None = Query(None, alias="from"),
        end: datetime | None = Query(None, alias="to"),
        limit: int = Query(500, ge=1, le=1000),
        session_token: str | None = Cookie(None, alias=SESSION_COOKIE),
    ):
        _, workspace_id = current_workspace(session_token)
        if runtime_history is None:
            return []
        return [
            asdict(item)
            for item in runtime_history.history_for_check(
                workspace_id, check_id, start=start, end=end, limit=limit
            )
        ]

    @app.get("/integrations/catalog")
    def integrations_catalog(session_token: str | None = Cookie(None, alias=SESSION_COOKIE)):
        current_workspace(session_token)
        return connector_catalog()

    @app.get("/household/devices")
    def household_devices(session_token: str | None = Cookie(None, alias=SESSION_COOKIE)):
        _, workspace_id = current_workspace(session_token)
        if runtime_devices is None:
            raise HTTPException(status_code=503, detail="device storage unavailable")
        return runtime_devices.list(workspace_id)

    @app.post("/household/devices", status_code=201)
    def add_household_device(
        request: Request,
        device: DeviceInput,
        session_token: str | None = Cookie(None, alias=SESSION_COOKIE),
        x_csrf_token: str | None = Header(None),
    ):
        _, workspace_id = current_workspace(session_token)
        require_write_guard(request, session_token, x_csrf_token)
        if runtime_devices is None:
            raise HTTPException(status_code=503, detail="device storage unavailable")
        try:
            created = runtime_devices.create(
                workspace_id,
                device.connector,
                device.name,
                device.endpoint,
                device.credential_ref,
                device.metadata,
                device.parent_id,
            )
            create_default_check(workspace_id, created)
            return created
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.patch("/household/devices/{device_id}")
    def rename_household_device(
        request: Request,
        device_id: int,
        device: DeviceRenameInput,
        session_token: str | None = Cookie(None, alias=SESSION_COOKIE),
        x_csrf_token: str | None = Header(None),
    ):
        _, workspace_id = current_workspace(session_token)
        require_write_guard(request, session_token, x_csrf_token)
        if runtime_devices is None:
            raise HTTPException(status_code=503, detail="device storage unavailable")
        try:
            return runtime_devices.rename(workspace_id, device_id, device.name)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/household/clients")
    def household_clients(session_token: str | None = Cookie(None, alias=SESSION_COOKIE)):
        _, workspace_id = current_workspace(session_token)
        if runtime_devices is None:
            raise HTTPException(status_code=503, detail="device storage unavailable")
        return runtime_devices.list_clients(workspace_id)

    @app.post("/household/clients", status_code=201)
    def add_household_client(
        request: Request,
        client: ClientInput,
        session_token: str | None = Cookie(None, alias=SESSION_COOKIE),
        x_csrf_token: str | None = Header(None),
    ):
        _, workspace_id = current_workspace(session_token)
        require_write_guard(request, session_token, x_csrf_token)
        if runtime_devices is None:
            raise HTTPException(status_code=503, detail="device storage unavailable")
        try:
            created = runtime_devices.create_client(
                workspace_id,
                client.name,
                endpoint=client.endpoint,
                mac_address=client.mac_address,
                connector=client.connector,
                parent_id=client.parent_id,
                metadata=client.metadata,
            )
            create_default_check(workspace_id, created)
            return created
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/integrations/{source}/clients/import")
    def import_clients_from_source(
        request: Request,
        source: str,
        config: IntegrationImportInput | None = None,
        parent_id: int | None = None,
        session_token: str | None = Cookie(None, alias=SESSION_COOKIE),
        x_csrf_token: str | None = Header(None),
    ):
        rate_limit(request, "client-import", 10, 3600)
        _, workspace_id = current_workspace(session_token)
        require_write_guard(request, session_token, x_csrf_token)
        if runtime_devices is None:
            raise HTTPException(status_code=503, detail="device storage unavailable")
        source_loader = runtime_client_source_loaders.get(source)
        if source_loader is None:
            raise HTTPException(status_code=400, detail=f"{source} client import is not implemented yet")
        try:
            if source == "unifi" and config is not None:
                imported_clients = fetch_unifi_clients(config.model_dump(exclude_none=True))
            else:
                imported_clients = source_loader()
            created = 0
            updated = 0
            devices = []
            for client in imported_clients:
                device, was_created = runtime_devices.upsert_client(
                    workspace_id,
                    client.name,
                    endpoint=client.endpoint,
                    mac_address=client.mac_address,
                    connector=client.connector,
                    parent_id=parent_id,
                    metadata=client.metadata,
                )
                create_default_check(workspace_id, device)
                devices.append(device)
                if was_created:
                    created += 1
                else:
                    updated += 1
            return {"created": created, "updated": updated, "clients": devices}
        except ClientSourceError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/household/discover")
    def discover_devices(
        request_context: Request,
        request: DiscoveryInput,
        session_token: str | None = Cookie(None, alias=SESSION_COOKIE),
        x_csrf_token: str | None = Header(None),
    ):
        rate_limit(request_context, "discovery", 10, 3600)
        current_workspace(session_token)
        require_write_guard(request_context, session_token, x_csrf_token)
        try:
            network = ipaddress.ip_network(request.network, strict=False)
            if not network.is_private or network.num_addresses > 256:
                raise ValueError("discovery is limited to private networks with at most 256 addresses")
            return [item.__dict__ for item in discover_network(request.network, workers=request.workers)]
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/household/discover/adopt", status_code=201)
    def adopt_discovered_device(
        request: Request,
        device: DiscoveryAdoptInput,
        session_token: str | None = Cookie(None, alias=SESSION_COOKIE),
        x_csrf_token: str | None = Header(None),
    ):
        _, workspace_id = current_workspace(session_token)
        require_write_guard(request, session_token, x_csrf_token)
        if runtime_devices is None:
            raise HTTPException(status_code=503, detail="device storage unavailable")
        name = device.hostname or device.address
        try:
            created = runtime_devices.create(
                workspace_id, "icmp", name, endpoint=device.address,
                metadata={"role": "client", "discovered": True, "open_ports": device.open_ports},
                parent_id=device.parent_id,
            )
            create_default_check(workspace_id, created)
            return created
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/check")
    def check(service: ServiceInput):
        return JSONResponse(status_code=410, content={"detail": "raw checks are disabled; create a workspace check first"})

    @app.get("/state")
    def state(session_token: str | None = Cookie(None, alias=SESSION_COOKIE)):
        require_authenticated_user(session_token)
        if runtime_engine is None:
            return []
        if runtime_checks is not None:
            _, workspace_id = current_workspace(session_token)
            return runtime_checks.states(workspace_id)
        return [asdict(item) for item in runtime_engine.states().values()]

    @app.get("/history/{service_name}")
    def service_history(
        service_name: str,
        start: datetime | None = Query(None, alias="from"),
        end: datetime | None = Query(None, alias="to"),
        limit: int = Query(500, ge=1, le=1000),
        session_token: str | None = Cookie(None, alias=SESSION_COOKIE),
    ):
        require_authenticated_user(session_token)
        if runtime_history is None:
            return []
        return [
            asdict(item)
            for item in runtime_history.history(
                service_name, start=start, end=end, limit=limit
            )
        ]

    assets = ui_root / "assets"
    index = ui_root / "index.html"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    if index.is_file():
        @app.get("/", include_in_schema=False)
        def ui_index():
            return FileResponse(index)

    return app


app = create_app(monitor=True)
