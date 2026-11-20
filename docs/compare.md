# GuestPass and the tools next to it

Most tools in this space answer one question: *how do I keep using my own agent session from another device?*

GuestPass answers a different one: *how do I let someone else, who has no account and nothing installed, talk to the session I already have open?*

| | Who is on the other end | What that person needs |
|---|---|---|
| **GuestPass** | Someone you invite: a manager, a client, a teammate, a family member | A browser. No account, no app. An optional password you set |
| [Claude Code Remote Control](https://code.claude.com/docs/en/remote-control) | You, on another device | Sign in at claude.ai or a Claude app. Available on paid plans |
| [Happy](https://github.com/slopus/happy) | You on your phone, or teammates on your team | The Happy app. Teammates are invited by email and sign in with their own Happy account |
| [HAPI](https://github.com/tiann/hapi) | You, on another device | The HAPI web app, native app, or Telegram Mini App, paired with your hub |
| [CloudCLI UI](https://github.com/siteboon/claudecodeui) | You, in a browser on desktop or mobile | Access to the machine or server where it runs |

Checked against each project's own README and docs on 2026-11-20. These projects move fast. If a row is out of date, open an issue or a pull request and we will fix it.

## When to use which

- You want to keep working from your phone: use Remote Control, Happy, or HAPI. They are built for that and do it better than GuestPass.
- You want a full web UI with files, git, and a terminal: use CloudCLI UI.
- You are in the middle of a session and want another person to ask it a few questions, right now, without setting anything up: that is GuestPass. Run `npx guestpass start`, send the link.

They also work together. GuestPass does not replace your agent or wrap it; it adds a guest link to a session that is already running.

## What GuestPass does not do

- No mobile app, no push notifications.
- No permission levels yet. A guest can ask the agent to do anything the agent can do on your computer, so share the link only with people you trust and set a password.
- The link lives only while your computer is on and the session is running.
