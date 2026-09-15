#!/usr/bin/env sh
set -eu

say() {
  printf '%s\n' "$1"
}

need_command() {
  command -v "$1" >/dev/null 2>&1
}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

cd "$repo_dir"

say "raffael installer"
say ""

os_name=$(uname -s 2>/dev/null || printf unknown)

install_with_brew() {
  package_name=$1
  if ! need_command brew; then
    say "homebrew is missing."
    say "installing homebrew first. it may ask for your mac password."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi

  if ! brew list "$package_name" >/dev/null 2>&1; then
    say "installing $package_name with homebrew."
    brew install "$package_name"
  fi
}

install_docker_with_brew() {
  if ! need_command brew; then
    say "homebrew is missing."
    say "installing homebrew first. it may ask for your mac password."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi

  if ! need_command docker; then
    say "installing docker desktop with homebrew."
    brew install --cask docker
  fi
}

install_linux_packages() {
  missing_git=$1
  missing_docker=$2

  if need_command apt-get; then
    say "installing missing packages with apt."
    sudo apt-get update
    if [ "$missing_git" = "1" ]; then
      sudo apt-get install -y git
    fi
    if [ "$missing_docker" = "1" ]; then
      sudo apt-get install -y docker.io docker-compose-plugin
      sudo systemctl enable --now docker || true
    fi
    return
  fi

  if need_command dnf; then
    say "installing missing packages with dnf."
    if [ "$missing_git" = "1" ]; then
      sudo dnf install -y git
    fi
    if [ "$missing_docker" = "1" ]; then
      sudo dnf install -y docker docker-compose-plugin
      sudo systemctl enable --now docker || true
    fi
    return
  fi

  if need_command pacman; then
    say "installing missing packages with pacman."
    if [ "$missing_git" = "1" ]; then
      sudo pacman -Sy --noconfirm git
    fi
    if [ "$missing_docker" = "1" ]; then
      sudo pacman -Sy --noconfirm docker docker-compose
      sudo systemctl enable --now docker || true
    fi
    return
  fi

  say "i could not find apt, dnf or pacman."
  say "please install git, docker and docker compose, then run this again."
  exit 1
}

if ! need_command git; then
  case "$os_name" in
    Darwin)
      install_with_brew git
      ;;
    Linux)
      install_linux_packages 1 0
      ;;
    *)
      say "git is missing and this installer does not know how to install it on $os_name."
      exit 1
      ;;
  esac
fi

if ! need_command docker; then
  case "$os_name" in
    Darwin)
      install_docker_with_brew
      ;;
    Linux)
      install_linux_packages 0 1
      ;;
    *)
      say "docker is missing and this installer does not know how to install it on $os_name."
      exit 1
      ;;
  esac
fi

if ! docker compose version >/dev/null 2>&1; then
  say "docker compose is missing."
  if [ "$os_name" = "Linux" ]; then
    install_linux_packages 0 1
  else
    say "please start or update docker desktop, then run this again."
    exit 1
  fi
fi

if ! docker info >/dev/null 2>&1; then
  say "docker is installed but not running."
  if [ "$os_name" = "Darwin" ]; then
    say "opening docker desktop. wait until the whale is ready, then run this installer again."
    open -a Docker || true
    exit 1
  fi
  say "start docker, then run this installer again."
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  say "created .env from .env.example."
else
  say ".env already exists. leaving it alone."
fi

if [ ! -f services.yaml ]; then
  cp services.example.yaml services.yaml
  say "created services.yaml from services.example.yaml."
else
  say "services.yaml already exists. leaving it alone."
fi

say "building and starting raffael."
docker compose up -d --build

say ""
say "done."
say "open raffael:"
say "  http://127.0.0.1:8080"
say ""
say "local mail inbox:"
say "  http://127.0.0.1:8025"
say ""
say "first step: create the first account in the browser."
