import 'reflect-metadata';

import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { BenchmarkServices } from '../shared/benchmark-services.js';
import { DeterministicWorkload } from '../shared/workload.js';
import type { ResourceDisposer } from '../shared/resource-ledger.js';
import type {
  LifecycleAdapter,
  ResourceLedgerSnapshot,
  WorkloadResult,
  WorkloadSpec,
} from '../shared/types.js';

// rq3:framework-orchestration:start
@Injectable()
class NestjsBenchmarkServices extends BenchmarkServices {}
// rq3:framework-orchestration:end

// rq3:plugin-lifecycle:start
@Injectable()
class NestjsBenchmarkPlugin {
  private workload: DeterministicWorkload | undefined;
  private readonly disposers: ResourceDisposer[] = [];

  constructor(private readonly services: NestjsBenchmarkServices) {}

  load(spec: WorkloadSpec): number {
    if (this.workload) throw new Error('NestJS benchmark plugin is already loaded.');

    const workload = new DeterministicWorkload(this.services.eventBus, spec);
    // rq3:cleanup:start
    workload.registerSubscriptions((create) => {
      this.disposers.push(create()); // rq3:cleanup-action:nominal
    });
    // rq3:cleanup:end
    this.workload = workload;
    return workload.expectedResult;
  }

  exercise(): WorkloadResult {
    if (!this.workload) throw new Error('NestJS benchmark plugin is not loaded.');
    return this.workload.exercise();
  }

  // rq3:cleanup:start
  dispose(): void {
    for (let index = this.disposers.length - 1; index >= 0; index -= 1) {
      this.disposers[index]!(); // rq3:cleanup-action:nominal
    }
    this.disposers.length = 0;
    this.workload = undefined;
  }
  // rq3:cleanup:end
}
// rq3:plugin-lifecycle:end

// rq3:framework-orchestration:start
@Module({ providers: [NestjsBenchmarkServices] })
class BenchmarkHostModule {}

export class NestjsLifecycleAdapter implements LifecycleAdapter {
  readonly framework = 'nestjs' as const;
  private application: INestApplicationContext | undefined;
  private moduleRef: ModuleRef | undefined;
  private services: NestjsBenchmarkServices | undefined;
  private activePlugin: NestjsBenchmarkPlugin | undefined;

  async initialize(): Promise<void> {
    if (this.application) throw new Error('NestJS lifecycle adapter is already initialized.');

    this.application = await NestFactory.createApplicationContext(BenchmarkHostModule, {
      abortOnError: false,
      logger: false,
    });
    this.moduleRef = this.application.get(ModuleRef);
    this.services = this.application.get(NestjsBenchmarkServices);
  }

  async load(spec: WorkloadSpec): Promise<number> {
    if (!this.moduleRef) throw new Error('NestJS lifecycle adapter is not initialized.');
    if (this.activePlugin) throw new Error('NestJS lifecycle adapter already has an active plugin.');

    const plugin = await this.moduleRef.create(NestjsBenchmarkPlugin);
    const expectedChecksum = plugin.load(spec);
    this.activePlugin = plugin;
    return expectedChecksum;
  }

  exercise(): WorkloadResult {
    if (!this.activePlugin) throw new Error('NestJS lifecycle adapter has no active plugin.');
    return this.activePlugin.exercise();
  }

  // rq3:cleanup:start
  async dispose(): Promise<void> {
    if (!this.activePlugin) throw new Error('NestJS lifecycle adapter has no active plugin.');
    this.activePlugin.dispose(); // rq3:cleanup-action:nominal
    this.activePlugin = undefined;
  }
  // rq3:cleanup:end

  ledgerSnapshot(): ResourceLedgerSnapshot {
    if (!this.services) throw new Error('NestJS lifecycle adapter is not initialized.');
    return this.services.ledger.snapshot();
  }

  // rq3:cleanup:start
  async close(): Promise<void> {
    if (this.activePlugin) await this.dispose(); // rq3:cleanup-action:host-shutdown
    await this.application?.close(); // rq3:cleanup-action:host-shutdown
    this.application = undefined;
    this.moduleRef = undefined;
    this.services = undefined;
  }
  // rq3:cleanup:end
}
// rq3:framework-orchestration:end
