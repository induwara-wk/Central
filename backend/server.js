'use strict';

const express       = require('express');
const cors          = require('cors');
const fs            = require('fs/promises');
const os            = require('os');
const { execFile }  = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ─────────────────────────────────────────────────────────────
// CPU
// ─────────────────────────────────────────────────────────────

async function readProcStat() {
  const raw = await fs.readFile('/proc/stat', 'utf8');
  return raw.split('\n')
    .filter(l => l.startsWith('cpu'))
    .map(line => {
      const [name, user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] =
        line.trim().split(/\s+/);
      const idleTotal = Number(idle) + Number(iowait);
      const nonIdle   = Number(user) + Number(nice) + Number(system) +
                        Number(irq)  + Number(softirq) + Number(steal);
      const total     = idleTotal + nonIdle;
      return { name, total, idle: idleTotal };
    });
}

let cpuPrevSample = null;

async function getCpuUsage() {
  if (!cpuPrevSample) {
    cpuPrevSample = await readProcStat();
    await new Promise(r => setTimeout(r, 500));
  }
  const prev = cpuPrevSample;
  const curr = await readProcStat();
  cpuPrevSample = curr;

  return curr.map((c, i) => {
    const p      = prev[i] ?? c;
    const dTotal = c.total - p.total;
    const dIdle  = c.idle  - p.idle;
    const pct    = dTotal > 0 ? ((dTotal - dIdle) / dTotal) * 100 : 0;
    return { name: c.name, usage: Math.max(0, Math.min(100, Math.round(pct * 10) / 10)) };
  });
}

async function getCpuInfo() {
  const raw = await fs.readFile('/proc/cpuinfo', 'utf8');
  let model = 'Unknown CPU';
  let cores = 0;
  for (const line of raw.split('\n')) {
    if (line.startsWith('model name') && model === 'Unknown CPU')
      model = line.split(':')[1]?.trim().replace(/\s+/g, ' ') ?? 'Unknown CPU';
    if (line.startsWith('processor')) cores++;
  }
  return { model, cores: cores || os.cpus().length };
}

// ─────────────────────────────────────────────────────────────
// MEMORY
// ─────────────────────────────────────────────────────────────

async function getMemInfo() {
  const raw = await fs.readFile('/proc/meminfo', 'utf8');
  const mem = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([\w()]+):\s+(\d+)/);
    if (m) mem[m[1]] = parseInt(m[2]) * 1024;
  }
  const total     = mem.MemTotal      ?? 0;
  const free      = mem.MemFree       ?? 0;
  const buffers   = mem.Buffers       ?? 0;
  const cached    = (mem.Cached ?? 0) + (mem.SReclaimable ?? 0) - (mem.Shmem ?? 0);
  const available = mem.MemAvailable  ?? (free + buffers + cached);
  const used      = Math.max(0, total - free - buffers - cached);
  const swapTotal = mem.SwapTotal     ?? 0;
  const swapFree  = mem.SwapFree      ?? 0;
  const swapUsed  = Math.max(0, swapTotal - swapFree);

  return {
    total, used, free, available, buffers, cached,
    percentage:     total     > 0 ? Math.round((used     / total)     * 1000) / 10 : 0,
    swapTotal, swapUsed, swapFree,
    swapPercentage: swapTotal > 0 ? Math.round((swapUsed / swapTotal) * 1000) / 10 : 0,
  };
}

// ─────────────────────────────────────────────────────────────
// UPTIME
// ─────────────────────────────────────────────────────────────

async function getUptime() {
  const raw = await fs.readFile('/proc/uptime', 'utf8');
  return parseFloat(raw.split(' ')[0]);
}

// ─────────────────────────────────────────────────────────────
// DISK
// ─────────────────────────────────────────────────────────────

const SKIP_FS = new Set([
  'tmpfs', 'devtmpfs', 'devpts', 'sysfs', 'proc', 'cgroup', 'cgroup2',
  'pstore', 'securityfs', 'debugfs', 'bpf', 'hugetlbfs', 'mqueue',
  'fusectl', 'configfs', 'tracefs', 'nsfs', 'ramfs', 'squashfs', 'autofs',
  'overlay', 'overlayfs', 'efivarfs', 'rpc_pipefs',
]);

const SKIP_MOUNT_PREFIX = ['/proc', '/sys', '/dev', '/run', '/snap', '/var/lib/docker'];

async function getDiskInfo() {
  try {
    const { stdout } = await execFileAsync('df', ['-B1', '-T'], { timeout: 8000 });
    const lines = stdout.trim().split('\n').slice(1);

    const hasHostMount = lines.some(l => {
      const cols = l.trim().split(/\s+/);
      return cols.length >= 7 && cols.slice(6).join(' ') === '/host';
    });

    const seen  = new Set();
    const disks = [];

    for (const line of lines) {
      const cols   = line.trim().split(/\s+/);
      if (cols.length < 7) continue;

      const source = cols[0];
      const fstype = cols[1];
      const size   = parseInt(cols[2]) || 0;
      const used   = parseInt(cols[3]) || 0;
      const avail  = parseInt(cols[4]) || 0;
      const pct    = parseFloat(cols[5].replace('%', '')) || 0;
      const mount  = cols.slice(6).join(' ');

      if (SKIP_FS.has(fstype))                                    continue;
      if (size === 0)                                             continue;
      if (source.startsWith('shm'))                               continue;
      if (SKIP_MOUNT_PREFIX.some(p => mount.startsWith(p)))      continue;
      if (hasHostMount && !mount.startsWith('/host'))             continue;
      if (seen.has(source)) continue;
      seen.add(source);

      disks.push({
        fs:        source,
        type:      fstype,
        size, used, available: avail, use: pct,
        mount: hasHostMount
          ? (mount === '/host' ? '/' : mount.slice(5))
          : mount,
      });
    }

    return disks;
  } catch (err) {
    console.error('getDiskInfo:', err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// OS INFO
// ─────────────────────────────────────────────────────────────

async function getOsInfo() {
  const hostEtc = await fs.access('/host/etc').then(() => '/host/etc').catch(() => '/etc');

  let hostname = os.hostname();
  let distro   = 'Linux';
  let release  = '';
  const arch   = os.arch();

  try {
    hostname = (await fs.readFile(`${hostEtc}/hostname`, 'utf8')).trim();
  } catch { }

  try {
    const raw  = await fs.readFile(`${hostEtc}/os-release`, 'utf8');
    const info = Object.fromEntries(
      raw.split('\n')
        .filter(l => l.includes('='))
        .map(l => {
          const idx = l.indexOf('=');
          return [l.slice(0, idx), l.slice(idx + 1).replace(/^"|"$/g, '').trim()];
        }),
    );
    distro  = info.PRETTY_NAME || info.NAME     || 'Linux';
    release = info.VERSION_ID  || info.BUILD_ID || '';
  } catch { }

  return { hostname, distro, release, arch, platform: os.platform() };
}

// ─────────────────────────────────────────────────────────────
// NETWORK
// ─────────────────────────────────────────────────────────────

let netPrev = { time: 0, stats: {} };

async function getNetworkRates() {
  try {
    const raw = await fs.readFile('/proc/net/dev', 'utf8');
    const now = Date.now();
    const curr = {};

    for (const line of raw.split('\n').slice(2)) {
      const [iface, rest] = line.split(':');
      if (!rest) continue;
      const vals = rest.trim().split(/\s+/).map(Number);
      const name = iface.trim();
      if (name === 'lo') continue;
      curr[name] = { rx: vals[0], tx: vals[8] };
    }

    const dt    = (now - netPrev.time) / 1000;
    const rates = Object.entries(curr).map(([name, c]) => {
      const p = netPrev.stats[name];
      return p && dt > 0
        ? { iface: name, rxSec: Math.max(0, (c.rx - p.rx) / dt), txSec: Math.max(0, (c.tx - p.tx) / dt) }
        : { iface: name, rxSec: 0, txSec: 0 };
    });

    netPrev = { time: now, stats: curr };
    return rates;
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.get('/api/stats', async (_req, res) => {
  try {
    const [cpuUsages, cpuInfo, memory, uptime, disks, osInfo, network] = await Promise.all([
      getCpuUsage(),
      getCpuInfo(),
      getMemInfo(),
      getUptime(),
      getDiskInfo(),
      getOsInfo(),
      getNetworkRates(),
    ]);

    const totalCpu = cpuUsages.find(c => c.name === 'cpu');
    const coreCpus = cpuUsages.filter(c => c.name !== 'cpu').map(c => c.usage);

    res.json({
      cpu: {
        usage:   totalCpu?.usage ?? 0,
        cores:   cpuInfo.cores,
        model:   cpuInfo.model,
        perCore: coreCpus,
      },
      ram:     memory,
      storage: disks,
      uptime,
      os:      osInfo,
      network,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('/api/stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\x1b[36m[ Central API ]\x1b[0m running → http://0.0.0.0:${PORT}`);
});