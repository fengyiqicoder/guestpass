# GuestPass

**Let anyone with a browser talk to your AI agent.** No account, nothing to install on their side.

You are in the middle of a session with Claude Code, Codex or another agent. It knows the project. You want a teammate, your boss or a client to ask it something or have it carry on. Run one command, send them the link, and they are talking to the same session from a web page.

```bash
npx guestpass start
```

```
Link: https://random-words.trycloudflare.com/r/aqJYeCwPBOKKjB9a
```

## How it works

```
Guest's browser  ->  Cloudflare tunnel  ->  GuestPass on your computer  ->  your agent session
```

- GuestPass runs a small web service on your computer and opens a free Cloudflare quick tunnel to it. No Cloudflare account is needed, and no server of ours is in the path.
- The guest's message is handed to your agent by `guestpass wait`. The agent answers in the same session, with the same context.
- The agent stays on your computer and uses your own plan.

## Install as a skill

```bash
npx skills add fengyiqicoder/guestpass
```

Then say "guestpass" or "share this session" to your agent. The skill tells it how to start, listen and reply.

## Commands

| Command | Does |
| --- | --- |
| `guestpass start` | Share this session and print the link. `--password <pw>` asks guests for a password |
| `guestpass wait` | Block until a guest writes, print the message, exit. `--timeout <seconds>` to give up sooner |
| `guestpass say` | Post the agent's reply to the page (text as an argument or on stdin) |
| `guestpass send <file>` | Share an image or file; prints Markdown for the reply |
| `guestpass status` | The link, who is on the page, whether the agent is listening |
| `guestpass stop` | End sharing |

## Which agents

Any agent that can run shell commands. With Claude Code, the page mirrors the session by itself: the conversation, the reply, and what the agent is doing right now. Other agents post their replies with `guestpass say`.

## Before you share

- **A guest can do what your agent can do.** Their messages go to the live session on your computer, with its files, shell and logins. Send the link only to people you trust, and set a password.
- **The page shows recent messages.** If the last 20 messages contain a key or a password, a guest sees it.
- **The link is temporary.** It is a random trycloudflare.com address that changes on every start and stops when your computer sleeps. For a fixed address on your own domain, set `GUESTPASS_TUNNEL_TOKEN` and `GUESTPASS_PUBLIC_URL` to a Cloudflare tunnel you own.
- **Your plan, your limits.** Guests use your agent subscription. Check your provider's terms before sharing widely.

Node 18 or later. `cloudflared` is downloaded on first use if it is not installed. MIT licence.
