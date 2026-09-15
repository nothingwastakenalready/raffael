$ErrorActionPreference = "Stop"

function Say($Message) {
    Write-Host $Message
}

function HasCommand($Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-WithWinget($Id, $Name) {
    if (-not (HasCommand "winget")) {
        throw "winget is missing. install 'app installer' from the microsoft store, then run this again."
    }

    Say "installing $Name with winget."
    winget install --id $Id --exact --accept-package-agreements --accept-source-agreements
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $RepoDir

Say "raffael installer"
Say ""

if (-not (HasCommand "git")) {
    Install-WithWinget "Git.Git" "git"
    Say "git was installed. close this terminal, open a new powershell window, and run this installer again."
    exit 1
}

if (-not (HasCommand "docker")) {
    Install-WithWinget "Docker.DockerDesktop" "docker desktop"
    Say "docker desktop was installed."
    Say "start docker desktop, finish its setup, wait until it says it is running, then run this installer again."
    exit 1
}

try {
    docker compose version | Out-Null
} catch {
    Say "docker compose is missing or docker desktop is not ready."
    Say "open docker desktop, let it finish setup, then run this installer again."
    exit 1
}

try {
    docker info | Out-Null
} catch {
    Say "docker is installed but not running."
    Say "start docker desktop, wait until it is ready, then run this installer again."
    exit 1
}

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Say "created .env from .env.example."
} else {
    Say ".env already exists. leaving it alone."
}

if (-not (Test-Path "services.yaml")) {
    Copy-Item "services.example.yaml" "services.yaml"
    Say "created services.yaml from services.example.yaml."
} else {
    Say "services.yaml already exists. leaving it alone."
}

Say "building and starting raffael."
docker compose up -d --build

Say ""
Say "done."
Say "open raffael:"
Say "  http://127.0.0.1:8080"
Say ""
Say "local mail inbox:"
Say "  http://127.0.0.1:8025"
Say ""
Say "first step: create the first account in the browser."
