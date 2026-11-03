---
status: accepted
date: 2026-11-03
---

# Local, stateless MCP server instead of a hosted service with a database

The project started as a hosted MCP server plus HTTP API backed by a package database refreshed
by background workers, with accounts and per-token rate limits. We dropped all of it: the server
runs on the user's machine over stdio, holds no data beyond a per-process cache, and asks the
public registries directly on every uncached call. The hosted design would have cost money and
operations time every month for a free tool, needed abuse protection for anonymous traffic, and
could only answer about packages already in its database. The local design costs nothing to run,
needs no accounts, and is never staler than the registry's own CDN cache.

## Consequences

- Anything that needs shared or persistent state (popularity ranking, server-side caching,
  usage analytics, private registry credentials) is out of scope by design, not by omission.
- Every call pays the registry round-trips; the per-registry concurrency limit, the request
  timeout and the 5 minute in-process cache exist to keep that acceptable.
- Rate-limit behaviour is the user's own: their IP talks to the registries.
