import { CordisLifecycleAdapter } from '../cordis-app/cordis-adapter.js';
import { NestjsLifecycleAdapter } from '../nestjs-app/nestjs-adapter.js';
import type { FrameworkName, LifecycleAdapter } from './types.js';

export function createAdapter(framework: FrameworkName): LifecycleAdapter {
  switch (framework) {
    case 'nestjs':
      return new NestjsLifecycleAdapter();
    case 'cordis':
      return new CordisLifecycleAdapter();
  }
}
