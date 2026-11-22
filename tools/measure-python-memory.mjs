/**
 * WO-14 measurement: how much memory a Python lesson costs after 100+ runs.
 *
 * This runs a real Pyodide (CPython in WebAssembly) in Node — the same runtime
 * the browser worker loads — and repeats the exact per-run lifecycle the worker
 * uses (`runtime-core.ts`). Two modes:
 *
 *   node tools/measure-python-memory.mjs            # the shipped lifecycle
 *   node tools/measure-python-memory.mjs --legacy    # what it was before WO-14
 *
 * The legacy mode is the previous worker: the namespace proxy is never
 * destroyed and the run directory is never removed, so the same 120 runs show
 * what the leak looked like.
 *
 * Usage:
 *   npx esbuild src/tracks/python/runtime-core.ts --bundle --format=esm \
 *     --outfile=.tmp/runtime-core.mjs
 *   PYODIDE_PATH=/path/to/node_modules/pyodide/pyodide.mjs \
 *     node --expose-gc tools/measure-python-memory.mjs [--legacy] [runs]
 */
const RUNS = Number(process.argv.find((arg) => /^\d+$/.test(arg)) ?? 120);
const LEGACY = process.argv.includes('--legacy');

const pyodideEntry = process.env.PYODIDE_PATH ?? 'pyodide';
const coreEntry = process.env.PK13_RUNTIME ?? new URL('../.tmp/runtime-core.mjs', import.meta.url).pathname;

const { executeProgram, runDirectory, writeTree, resetInterpreter } = await import(coreEntry);
const { loadPyodide } = await import(pyodideEntry);

const indexURL = pyodideEntry.replace(/\/[^/]+$/, '/');
const py = await loadPyodide({ indexURL });

const FILES = {
  'main.py': [
    'from practice import numbers',
    // ~1 MB of Python objects per run: enough that a namespace which is never
    // released shows up as growth, and small enough to run a hundred times.
    'rows = ["row-%05d" % i + "x" * 80 for i in range(10000)]',
    'total = sum(numbers)',
    'print(total, len(rows))',
    '',
  ].join('\n'),
  'practice.py': 'numbers = [1, 2, 3, 4, 5]\n',
};

const mib = (bytes) => (bytes / 1024 / 1024).toFixed(1);
const gcNow = () => {
  if (typeof globalThis.gc === 'function') globalThis.gc();
};

/** The WASM heap Pyodide grows from — the number that used to climb. */
const heap = () => py._module.HEAP8.byteLength;

const vfsEntries = () => {
  const listing = py.runPython('__import__("os").listdir("/tmp/codeplayground")');
  try {
    return Array.from(listing.toJs());
  } finally {
    listing.destroy?.();
  }
};

const runDirs = () => vfsEntries().filter((name) => name.startsWith('run-')).length;

const legacyRun = async (id) => {
  // The previous worker, verbatim in behaviour: no destroy, no directory sweeper.
  const dir = runDirectory(id);
  const factory = py.globals.get('dict');
  const namespace = factory();
  namespace.set('__name__', '__main__');
  writeTree(py, dir, FILES);
  py.setStdout({ batched: () => undefined });
  py.setStderr({ batched: () => undefined });
  py.runPython(
    [
      'import sys, importlib',
      'for _name in list(sys.modules):',
      '    _module = sys.modules.get(_name)',
      "    _file = getattr(_module, '__file__', None) or ''",
      "    if _file.startswith('/tmp/codeplayground'):",
      '        sys.modules.pop(_name, None)',
      'sys.path = [p for p in sys.path if not str(p).startswith("/tmp/codeplayground")]',
      'importlib.invalidate_caches()',
      '',
    ].join('\n'),
  );
  py.runPython(
    `import sys, os\nsys.path.insert(0, ${JSON.stringify(dir)})\nos.chdir(${JSON.stringify(dir)})`,
  );
  await py.runPythonAsync(FILES['main.py'], { globals: namespace, filename: 'main.py' });
  // deliberately nothing is released here
};

const currentRun = async (id) => {
  await executeProgram(py, {
    code: FILES['main.py'],
    files: FILES,
    entry: 'main.py',
    dir: runDirectory(id),
    onStdout: () => undefined,
    onStderr: () => undefined,
  });
};

// Reset whatever an earlier measurement in this process left behind.
py.runPython('import shutil, os\nshutil.rmtree("/tmp/codeplayground", ignore_errors=True)');

// Warm the runtime up first: module loading, code caches and the import system
// all allocate once, and that one-time cost is not what 100 runs accumulate.
for (let i = 1; i <= 5; i += 1) await (LEGACY ? legacyRun(i) : currentRun(i));
gcNow();

const settle = async () => {
  // Let GC and the wasm allocator reach a quiet point before sampling.
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve));
  gcNow();
};

await settle();
const startHeap = heap();
const startRss = process.memoryUsage().rss;
const samples = [];

for (let i = 1; i <= RUNS; i += 1) {
  await (LEGACY ? legacyRun(1000 + i) : currentRun(1000 + i));
  if (i === 1 || i % 10 === 0 || i === RUNS) {
    await settle();
    samples.push({
      run: i,
      heapMiB: Number(mib(heap())),
      heapGrowthMiB: Number(mib(heap() - startHeap)),
      jsHeapMiB: Number(mib(process.memoryUsage().heapUsed)),
      rssMiB: Number(mib(process.memoryUsage().rss)),
      dirs: runDirs(),
    });
  }
}

await settle();
const endHeap = heap();
const endRss = process.memoryUsage().rss;

const report = {
  mode: LEGACY ? 'legacy (no PyProxy destroy, no VFS cleanup)' : 'current (WO-14 lifecycle)',
  runs: RUNS,
  pyodide: py.version ?? py.runPython('__import__("sys").version.split()[0]'),
  wasmHeap: {
    startMiB: Number(mib(startHeap)),
    endMiB: Number(mib(endHeap)),
    growthMiB: Number(mib(endHeap - startHeap)),
    growthPerRunKiB: Number(((endHeap - startHeap) / RUNS / 1024).toFixed(1)),
  },
  process: {
    rssStartMiB: Number(mib(startRss)),
    rssEndMiB: Number(mib(endRss)),
    rssGrowthMiB: Number(mib(endRss - startRss)),
    jsHeapEndMiB: Number(mib(process.memoryUsage().heapUsed)),
  },
  vfs: {
    rootEntriesAfter: vfsEntries().length,
    leftoverRunDirectories: runDirs(),
    firstLeftovers: vfsEntries().slice(0, 5),
  },
  samples,
};

console.log(JSON.stringify(report, null, 2));
py.destroy?.();
process.exit(0);
