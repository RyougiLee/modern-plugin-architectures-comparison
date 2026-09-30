import { Context, type ForkScope } from 'cordis';

import { BenchmarkServices } from '../shared/benchmark-services.js';
import { DeterministicWorkload } from '../shared/workload.js';
import type {
  LifecycleAdapter,
  ResourceLedgerSnapshot,
  WorkloadResult,
  WorkloadSpec,
} from '../shared/types.js';

// rq3:plugin-lifecycle:start
interface CordisPluginConfig {
  services: BenchmarkServices;
  spec: WorkloadSpec;
  attach(workload: DeterministicWorkload): void;
}

class CordisBenchmarkPlugin {
  static reusable = true;

  constructor(ctx: Context, config: CordisPluginConfig) {
    const workload = new DeterministicWorkload(config.services.eventBus, config.spec);
    // rq3:cleanup:start
    workload.registerSubscriptions((create) => {
      ctx.effect(create); // rq3:cleanup-action:nominal
    });
    // rq3:cleanup:end
    config.attach(workload);
  }
}
// rq3:plugin-lifecycle:end

// rq3:framework-orchestration:start
export class CordisLifecycleAdapter implements LifecycleAdapter {
  readonly framework = 'cordis' as const;
  private root: Context | undefined;
  private services: BenchmarkServices | undefined;
  private activeFork: ForkScope<Context> | undefined;
  private activeWorkload: DeterministicWorkload | undefined;

  async initialize(): Promise<void> {
    if (this.root) throw new Error('Cordis lifecycle adapter is already initialized.');

    this.root = new Context();
    this.services = new BenchmarkServices();
    await this.root.start();
  }

  async load(spec: WorkloadSpec): Promise<number> {
    if (!this.root || !this.services) throw new Error('Cordis lifecycle adapter is not initialized.');
    if (this.activeFork) throw new Error('Cordis lifecycle adapter already has an active plugin.');

    let attachedWorkload: DeterministicWorkload | undefined;
    const fork = this.root.plugin(CordisBenchmarkPlugin, {
      services: this.services,
      spec,
      attach(workload) {
        attachedWorkload = workload;
      },
    });
    if (!attachedWorkload) {
      // rq3:cleanup:start
      fork.dispose(); // rq3:cleanup-action:failure-recovery
      // rq3:cleanup:end
      throw new Error('Cordis plugin did not attach its workload synchronously.');
    }

    this.activeFork = fork;
    this.activeWorkload = attachedWorkload;
    return attachedWorkload.expectedResult;
  }

  exercise(): WorkloadResult {
    if (!this.activeWorkload) throw new Error('Cordis lifecycle adapter has no active plugin.');
    return this.activeWorkload.exercise();
  }

  // rq3:cleanup:start
  async dispose(): Promise<void> {
    if (!this.activeFork) throw new Error('Cordis lifecycle adapter has no active plugin.');
    const disposed = this.activeFork.dispose(); // rq3:cleanup-action:nominal
    if (!disposed) throw new Error('Cordis fork was already disposed.');
    this.activeFork = undefined;
    this.activeWorkload = undefined;
  }
  // rq3:cleanup:end

  ledgerSnapshot(): ResourceLedgerSnapshot {
    if (!this.services) throw new Error('Cordis lifecycle adapter is not initialized.');
    return this.services.ledger.snapshot();
  }

  // rq3:cleanup:start
  async close(): Promise<void> {
    if (this.activeFork) await this.dispose(); // rq3:cleanup-action:host-shutdown
    await this.root?.stop(); // rq3:cleanup-action:host-shutdown
    this.root = undefined;
    this.services = undefined;
  }
  // rq3:cleanup:end
}
// rq3:framework-orchestration:end
