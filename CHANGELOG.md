# Changelog

## 0.1.3 (2026-11-23)

- New: `--room <name>` keeps the same link path across restarts. With your own tunnel domain a link you already sent keeps working; with the default trycloudflare.com address the domain still changes
- New: `--port <number>` runs the local server on a fixed port
- Fixed: with your own Cloudflare tunnel (`GUESTPASS_TUNNEL_TOKEN`), the tunnel now routes to the local port by itself; no ingress rule to set up in the dashboard

## 0.1.2 (2026-11-22)

- New: the link now shows a preview card (title and description) when pasted into chat apps
- New: the guest page footer says what GuestPass is and how to share your own session
- New: installable as a Claude Code plugin (`/plugin marketplace add fengyiqicoder/guestpass`)

## 0.1.1 (2026-11-20)

- Fixed: on phones the guest chat panel covered the message box and could not be closed
- Fixed: the Enter button on the password screen was cut off
- Fixed: on phones the guest chat button sat on top of the message box
- README: demo, per-agent status, Chinese version

## 0.1.0 (2026-11-18)

First release.

- `guestpass start`, `wait`, `say`, `send`, `status`, `stop`
- Guest page in the browser, English and Chinese
- Optional password for guests
- Claude Code sessions are mirrored to the page automatically
- Free Cloudflare quick tunnel; `cloudflared` is downloaded when missing
- Agent skill: `npx skills add fengyiqicoder/guestpass`
