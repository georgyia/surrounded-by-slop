# Security Policy

## Supported versions

The project is pre-1.0; only the **latest release** receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately via
[GitHub Security Advisories](https://github.com/georgyia/surrounded-by-slop/security/advisories/new).

You can expect:

- an acknowledgement within **72 hours**,
- a status update at least every **7 days**,
- coordinated disclosure — we publish an advisory and credit you (if you wish)
  once a fix is released, at the latest **90 days** after the report.

## Scope notes

The extension analyzes code **locally** and makes **no network requests**.
Anything that violates that promise — data leaving the machine, code execution
triggered by merely opening a workspace — is a critical vulnerability and
exactly what this policy is for.
