# Host browser

DSH Web has **no Chromium, Playwright browser, X11, VNC or desktop** in either
image. Browser automation is a host attachment, not a container payload.

## Supported shape

```text
DSH Web container ── BrowserSkill MCP/WS ──> host browser extension
```

- Use the official DSH browser plugin or BrowserSkill against a browser that
  already runs on the host, workstation or another machine.
- The container needs a reachable host/endpoint and the plugin configuration.
  Do not mount `/dev/dri`, an X11 socket, a VNC port or a browser profile into
  the DSH container for this purpose.
- A browser extension profile contains cookies and sessions. Treat it as host
  user data, not DSH `/data`.

## Boundaries

- **No bundled binary:** the image cannot launch Chromium locally. A plugin
  that expects `/usr/bin/chromium` will fail.
- **Network reachability is required:** if the host browser bridge is only on
  loopback, publish it on a concrete private address or use an authenticated
  tunnel; never expose it to the public Internet.
- **Prompt cost:** BrowserSkill injects schemas and tools into every agent
  session. Keep it in a dedicated profile if prompt budget matters.
- **Security:** the browser is outside the DSH sandbox and outside the
  forward-auth boundary. A compromised browser bridge is equivalent to a
  compromised agent tool. Restrict its bearer token and network source.
