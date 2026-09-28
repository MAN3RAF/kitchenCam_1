import { tmpdir } from 'node:os';
import { Store } from './storage.ts';
import { Coordinator } from './coordinator.ts';
import { PhaseBLifecycle } from './lifecycle.ts';
import { localRpc } from './service-rpc.ts';
import { Failure, fail } from './policy.ts';
// Source import is a trusted operator's Store.import(Buffer), not an upload API.
try {
  const [command, root, scanId, inputRef] = process.argv.slice(2);
  if (command === 'init') {
    process.stdout.write(`${(await Store.create(root ?? tmpdir())).root}\n`);
  } else {
    if (!root) fail('PATH_INVALID');
    const rpc = localRpc(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    );
    const lifecycle = new PhaseBLifecycle(rpc),
      coordinator = new Coordinator(new Store(root), lifecycle);
    if (command === 'recover') await coordinator.recover(rpc);
    else if (command === 'run' && scanId && inputRef) {
      const abort = new AbortController();
      process.once('SIGTERM', () => abort.abort());
      process.once('SIGINT', () => abort.abort());
      const result = await coordinator.process(
        await lifecycle.claim(scanId),
        inputRef,
        abort.signal,
      );
      // No lease, digest, source path, metadata or credentials in operational output.
      process.stdout.write(
        JSON.stringify({
          jobId: result.jobId,
          status: result.status,
          ...('category' in result ? { category: result.category } : {}),
        }) + '\n',
      );
      if (result.status !== 'SUCCESS') process.exitCode = 1;
    } else fail('INTERNAL');
  }
} catch (error) {
  process.stderr.write(
    JSON.stringify({ category: error instanceof Failure ? error.category : 'INTERNAL' }) + '\n',
  );
  process.exitCode = 1;
}
