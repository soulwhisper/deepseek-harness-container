# Host browser

DSH Web has **no Chromium, Playwright browser, X11, VNC or desktop** in either
image. Browser automation is an operator-supplied plugin plus a browser
extension outside the container. Do not mount `/dev/dri`, an X11 socket, a VNC
port or a browser profile into the DSH container for this purpose.

## Install the plugin

The plugin is not bundled. Install it into the writable Web profile through the
market or the native CLI:

```bash
dsh plugin --profile web add @wxg-prc-cpg/browser-skill-dsh-plugin
```

The plugin's `cordis.patch.yml` inserts row `id: browserskill`. Configure it in
the profile patch, keeping one list:

```yaml
- id: browserskill
  config:
    bskPath: /usr/local/bin/bsk
    defaultTimeoutMs: 120000
    maxSessions: 5
    lazyTools: true
```

`bskPath` must point to the BrowserSkill CLI **inside the container**. The image
does not ship `bsk`; install it from the BrowserSkill release or mount a
reviewed binary. The CLI and the Chrome/Edge extension must support the same
BrowserSkill release. The extension owns the browser profile, cookies and
sessions; keep those on the host, not on `/data`.

The BrowserSkill CLI talks to the browser extension/daemon, not to an HTTP
endpoint that this image exposes. A loopback-only daemon on the host is not
reachable from the container bridge; run the daemon on an address reachable
from the container, or use a private tunnel. Never publish it to the public
Internet. There is no bearer-token option in this plugin configuration; protect
the daemon with network policy and its own transport security.

## Boundaries

- **No bundled binary:** the image cannot launch Chromium locally. A plugin
  that expects `/usr/bin/chromium` will fail.
- **Prompt cost:** BrowserSkill adds schemas and tools to the agent session.
  Keep it in a dedicated profile if prompt budget matters.
- **Security:** the browser is outside the DSH sandbox and outside the
  forward-auth boundary. A compromised browser bridge is equivalent to a
  compromised agent tool. Restrict the daemon's network source and keep the
  browser profile separate from DSH credentials.
