# RQ3 Code-Counting Rule

Status: **frozen for experiment version `rq3-sloc-v2`**

This rule measures explicit lifecycle-management code only. It does not measure
Developer Experience, cognitive load, usability, or developer satisfaction.

## Metrics

For each framework, report these six metrics separately:

1. `pluginLifecycleSloc`: physical source lines inside the benchmark plugin
   implementation that create, exercise, track, or dispose the plugin lifecycle.
2. `frameworkSpecificLifecycleOrchestrationSloc`: physical source lines in the
   framework-specific adapter/glue that create the host, create and retain the
   plugin lifecycle handle, invoke disposal, expose ledger state, and close the
   host.
3. `cleanupSloc`: the subset of the two regions directly concerned with
   registering cleanup ownership, invoking cleanup/disposal, and clearing owned
   lifecycle state.
4. `nominalPluginCleanupActions`: cleanup registration or invocation sites on the
   normal per-plugin load/dispose path. This is the primary RQ3 cleanup-action
   metric.
5. `hostShutdownCleanupActions`: cleanup invocations used to close the persistent
   framework host or to dispose a still-active plugin while closing that host.
6. `failureRecoveryCleanupActions`: cleanup invocations used only to recover from
   an exceptional or incomplete plugin-load path.

The three action categories are mutually exclusive. Host shutdown and failure
recovery are supporting metrics and must not be added to the nominal plugin count
when answering RQ3.

Braces, decorators, declarations, control flow, and executable statements count
as physical SLOC when they occur inside a marked region. Imports, blank lines,
comment-only lines, tests, shared workload code, runner code, logging, generated
files, and framework/library source do not count.

## Counted files and regions

- `nestjs-app/nestjs-adapter.ts`
- `cordis-app/cordis-adapter.ts`

The authoritative regions are delimited by `rq3:plugin-lifecycle`,
`rq3:framework-orchestration`, and `rq3:cleanup` marker comments. Explicit
actions carry one of these trailing markers:

- `rq3:cleanup-action:nominal`
- `rq3:cleanup-action:host-shutdown`
- `rq3:cleanup-action:failure-recovery`

Marker comments themselves never count. Relabeling these markers does not change
the executable lifecycle implementation.

Run the reproducible counter from `01_testbed`:

```powershell
npm run rq3:count
```

The command identifies the exact counted files in its JSON output. Any later
change to this rule requires a new rule version. After final data collection
begins, `rq3-sloc-v2` must not be redefined in place.
