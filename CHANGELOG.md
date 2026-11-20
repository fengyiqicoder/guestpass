# Changelog

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
