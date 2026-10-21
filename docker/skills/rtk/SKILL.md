---
name: rtk
description: >
  Use the bundled RTK OSS command proxy to compress verbose, non-interactive
  command output before it enters the agent context. Use it for large git,
  search, test, build or log output; run the raw command when unsupported.
---
# rtk

RTK is installed as `rtk` in the image. It wraps supported commands and
compresses their output for the model while preserving the command's result.

## Use it for

- Large, non-interactive command output where the full raw text is not needed:
  `rtk git status`, `rtk git diff`, `rtk cargo test`, `rtk rg <pattern>`.
- The same command more than once when a shorter summary is enough.

Check `rtk --help` for the current supported command set. RTK is an optional
convenience, not a shell replacement or an automatic hook.

## Do not use it for

- Interactive programs, prompts, editors, pagers or commands that require a
  TTY.
- Commands whose exact raw output is evidence: error transcripts, full JSON,
  patches, generated files, or security-sensitive output.
- Commands that print credentials, tokens, private keys or other secrets.
- Destructive or state-changing commands where a proxy could alter the
  approval or exit-code path.

## Failure handling

If RTK rejects a command, returns suspicious or incomplete output, or changes
the exit status, run the original command without RTK and use that result. Do
not retry a failed command through the proxy. `rtk gain` shows the local
savings dashboard when available.
