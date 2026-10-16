# Security policy

Framebop Studio runs AI models and downloaded programs on your computer, so
security reports matter even at this early stage.

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private vulnerability
reporting: the repository's **Security** tab, then **Report a vulnerability**.
Include what you found, how to reproduce it and what it could allow.

You can expect an acknowledgement within a week. Fixes are released as soon
as they are ready, and reporters are credited unless they ask not to be.

## Scope

Of particular interest:

- Downloads that are used without matching their pinned SHA-256, or files
  written outside the library's own folders.
- Anything that lets a prompt, file name or model file reach a program as an
  option or a shell command.
- The local engine bridge accepting requests from other origins.
- Anything that sends data off the computer without the user's consent.

## Supported versions

Only the latest development version is supported until the first release.
