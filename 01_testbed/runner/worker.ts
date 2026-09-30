import { executeWorkerRequest } from './execute.js';
import type { WorkerRequest, WorkerResponse } from './worker-contract.js';

async function main(): Promise<void> {
  const encoded = process.argv[2];
  if (!encoded) throw new Error('Worker request argument is required.');

  const request = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as WorkerRequest;
  const response: WorkerResponse = { artifact: await executeWorkerRequest(request) };
  process.stdout.write(JSON.stringify(response));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
