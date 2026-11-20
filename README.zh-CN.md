# GuestPass

[English](README.md)

**给你的 AI Agent 会话发一张访客通行证，开源。** 对方只要有浏览器，就能接着和你电脑上正在跑的 Claude Code、Codex、Gemini CLI 会话对话。不用账号，不用装任何东西。

```bash
npx guestpass start --password 自己定一个
```

```
Link: https://random-words.trycloudflare.com/r/aqJYeCwPBOKKjB9a
```

把链接发出去。同事、老板、客户用手机或电脑打开，问的就是你那个会话，项目上下文都在。

## 为什么做

现有的会话分享办法，多数要对方也装 Agent 或者登录账号。可你想给看的人往往装不了，也不想装。GuestPass 只要对方有浏览器。

- **一条命令。** 不用部署服务器，不用 Cloudflare 账号，不用配置。
- **同一个会话。** 不是副本，也不是聊天记录：访客的话直接交给正在运行的 Agent。
- **留在你的电脑上。** GuestPass 在本机运行，开一条免费的 Cloudflare 临时隧道，中间没有我们的服务器。
- **能跑命令行的 Agent 都能用。** 零依赖，Node 18 以上。

## 开始用

装成 skill（Agent 自己启动、监听、回复）：

```bash
npx skills add fengyiqicoder/guestpass
```

然后对 Agent 说“guestpass”或“把这个会话分享出去”。

也可以手动：

```bash
npx guestpass start --password 自己定一个   # 打印链接
npx guestpass wait                          # 等访客消息，来了就打印
npx guestpass say "回复内容"                 # 把 Agent 的回答发到网页
npx guestpass stop
```

## 支持哪些 Agent

| Agent | 状态 |
| --- | --- |
| Claude Code | 已实测。网页自动同步会话：对话、回复、Agent 正在做什么 |
| Codex、Gemini CLI、Cursor、OpenCode | 能识别名字，Agent 用 `guestpass say` 发回复。还没有完整实测，欢迎[反馈](https://github.com/fengyiqicoder/guestpass/issues) |
| 其他能跑命令行的 | 通过 `guestpass wait` 和 `guestpass say` 使用 |

## 分享前要知道

- **访客能做你的 Agent 能做的一切。** 消息进的是你电脑上的真实会话，带着文件、命令行和登录状态。只发给信得过的人，并设密码。
- **网页会显示最近的消息。** 最近 20 条里如果有密钥或密码，访客看得到。
- **链接是临时的。** 地址是随机的 trycloudflare.com，每次启动都变，电脑休眠就断。想要固定地址，把 `GUESTPASS_TUNNEL_TOKEN` 和 `GUESTPASS_PUBLIC_URL` 设成你自己的 Cloudflare 隧道。
- **用的是你的套餐。** 访客消耗你的 Agent 订阅额度，大范围分享前先看服务商的条款。

## 计划和反馈

接下来：只读和先问主人两种访客模式、更多 Agent 的会话同步、不用自己域名的固定链接。先做哪个看大家要什么，欢迎提 [issue](https://github.com/fengyiqicoder/guestpass/issues)。更新记录见 [CHANGELOG.md](CHANGELOG.md)。

MIT 协议。
