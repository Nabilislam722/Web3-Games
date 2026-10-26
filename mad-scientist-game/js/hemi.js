// Hemi client for Bitcoin Block Raids, without dependencies.
//
// Reads Bitcoin blocks through Hemi's hVM (via the hBK contract) and the raid
// leaderboard over plain JSON-RPC, and talks to the player's browser wallet
// (EIP-1193 / EIP-6963) to submit scores.

import { HEMI_NETWORKS, DEFAULT_NETWORK, RAID_LENGTH } from './hemi-config.js';

// Function selectors: first 4 bytes of keccak256(signature).
export const SEL = {
  getLastHeader: '0x869e8179', // getLastHeader()
  getHeaderN: '0x8a87e93e', // getHeaderN(uint32)
  currentRaid: '0x5f6f7840', // currentRaid()
  raidLength: '0x36d62175', // raidLength()
  getLeaderboard: '0xfc8541fb', // getLeaderboard(uint32)
  bestScore: '0xb7a4dec3', // bestScore(uint32,address)
  submitScore: '0x93a9214c', // submitScore(uint32,uint32,uint32,uint16,uint8)
};

const ERRORS = {
  '0x70e5a77c': 'RaidClosed', // RaidClosed(uint32,uint32)
  '0x34f9b08d': 'NotImproved', // NotImproved(uint32)
  '0x74345b88': 'InvalidRun', // InvalidRun()
  '0x08c379a0': 'Error', // Error(string)
};

// ------------------------------------------------------------ ABI codec ----

/** ABI-encode a call whose arguments are all static (uints and addresses). */
export function encodeCall(selector, ...args) {
  return selector + args.map((a) => BigInt(a).toString(16).padStart(64, '0')).join('');
}

/** Split ABI return data into 32-byte words (hex strings without 0x). */
export function words(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error('Malformed ABI data');
  const out = [];
  for (let i = 0; i + 64 <= h.length; i += 64) out.push(h.slice(i, i + 64));
  return out;
}

const num = (w) => Number(BigInt('0x' + w));
const b32 = (w) => '0x' + w;
const addr = (w) => '0x' + w.slice(24);

/** BitcoinHeader is a fully static struct, so it is returned inline. */
export function decodeHeader(hex) {
  const w = words(hex);
  if (w.length < 8) throw new Error('Unexpected header data');
  return {
    height: num(w[0]), blockHash: b32(w[1]), version: num(w[2]), previousBlockHash: b32(w[3]),
    merkleRoot: b32(w[4]), timestamp: num(w[5]), bits: num(w[6]), nonce: num(w[7]),
  };
}

export function decodeRaid(hex) {
  const w = words(hex);
  return { raidId: num(w[0]), startHeight: num(w[1]), seed: b32(w[2]), tipHeight: num(w[3]) };
}

/** Entry[] memory: offset, length, then 6 words per entry. */
export function decodeLeaderboard(hex) {
  const w = words(hex);
  if (!w.length) return [];
  const start = num(w[0]) / 32;
  const n = num(w[start]);
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = w.slice(start + 1 + i * 6, start + 7 + i * 6);
    out.push({ player: addr(e[0]), score: num(e[1]), kills: num(e[2]), wave: num(e[3]), weapon: num(e[4]), btcHeight: num(e[5]) });
  }
  return out;
}

/** Find revert data in the many shapes wallets and nodes wrap it in. */
export function revertData(err) {
  const seen = new Set();
  const visit = (v) => {
    if (!v || seen.has(v)) return null;
    if (typeof v === 'string') return /^0x[0-9a-f]{8}([0-9a-f]{64})*$/i.test(v) ? v : null;
    if (typeof v !== 'object') return null;
    seen.add(v);
    for (const k of ['data', 'result', 'originalError', 'error', 'cause', 'info']) {
      const found = visit(v[k]);
      if (found) return found;
    }
    return null;
  };
  return visit(err);
}

export function decodeRevert(data) {
  if (!data) return null;
  const name = ERRORS[data.slice(0, 10).toLowerCase()];
  if (!name) return null;
  const w = words(data.slice(10));
  if (name === 'Error') {
    const len = num(w[1] || '0');
    const bytes = (w.slice(2).join('').slice(0, len * 2).match(/../g) || []).map((b) => parseInt(b, 16));
    return { name, args: [new TextDecoder().decode(new Uint8Array(bytes))] };
  }
  return { name, args: w.map(num) };
}

// ---------------------------------------------------------------- errors ----

export class HemiError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

function friendly(err) {
  if (err instanceof HemiError) return err;
  const code = err?.code ?? err?.data?.originalError?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return new HemiError('rejected', 'You cancelled the request in your wallet.');
  if (code === -32002) return new HemiError('busy', 'Your wallet already has a request open. Check the wallet window.');
  const rev = decodeRevert(revertData(err));
  if (rev?.name === 'NotImproved') return new HemiError('notImproved', `Your best in this raid is already ${rev.args[0].toLocaleString()}. Beat it to resubmit.`, { best: rev.args[0] });
  if (rev?.name === 'RaidClosed') return new HemiError('raidClosed', 'This raid has closed on Bitcoin, so its scores are final.');
  if (rev?.name === 'InvalidRun') return new HemiError('invalid', 'This run has no score to record.');
  if (/insufficient funds/i.test(err?.message || '')) return new HemiError('funds', 'Your wallet needs a little ETH on Hemi to pay the gas fee.');
  return new HemiError('unknown', err?.message ? `Hemi request failed: ${err.message}` : 'Hemi request failed.');
}

// ------------------------------------------------------------- the client ----

const wallets = [];
if (typeof window !== 'undefined') {
  // EIP-6963: wallets announce themselves, which also works with several installed.
  window.addEventListener('eip6963:announceProvider', (e) => {
    if (e.detail?.provider && !wallets.some((w) => w.provider === e.detail.provider)) wallets.push(e.detail);
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

export class Hemi {
  constructor(networkKey) {
    const fromUrl = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('hemi') : null;
    this.key = HEMI_NETWORKS[networkKey] ? networkKey : HEMI_NETWORKS[fromUrl] ? fromUrl : DEFAULT_NETWORK;
    this.net = HEMI_NETWORKS[this.key];
    this.chainHex = '0x' + this.net.chainId.toString(16);
    this.account = null;
    this.listeners = new Set();
    this.cache = new Map();
    this.rpcId = 0;
  }

  get hasArena() { return /^0x[0-9a-fA-F]{40}$/.test(this.net.arena); }

  get provider() {
    return wallets[0]?.provider || (typeof window !== 'undefined' ? window.ethereum : null) || null;
  }

  get walletName() { return wallets[0]?.info?.name || 'wallet'; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }

  txUrl(hash) { return this.net.explorer ? `${this.net.explorer}/tx/${hash}` : ''; }
  addressUrl(a) { return this.net.explorer ? `${this.net.explorer}/address/${a}` : ''; }

  // ---------------------------------------------------------- reads ----

  async rpc(method, params) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    try {
      const res = await fetch(this.net.rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++this.rpcId, method, params }),
        signal: ctrl.signal,
      });
      const body = await res.json();
      if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code, data: body.error.data });
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }

  /** eth_call through the public RPC, falling back to the wallet when it is on Hemi. */
  async call(to, data) {
    try {
      return await this.rpc('eth_call', [{ to, data }, 'latest']);
    } catch (err) {
      if (revertData(err)) throw err;
      const p = this.provider;
      if (p && this.account) {
        const chain = await p.request({ method: 'eth_chainId' }).catch(() => null);
        if (chain?.toLowerCase() === this.chainHex) return p.request({ method: 'eth_call', params: [{ to, data }, 'latest'] });
      }
      throw new HemiError('offline', `Can't reach ${this.net.name} right now. Check your connection and try again.`);
    }
  }

  async cached(key, ms, fn) {
    const hit = this.cache.get(key);
    if (hit && performance.now() - hit.t < ms) return hit.v;
    const v = await fn();
    this.cache.set(key, { t: performance.now(), v });
    return v;
  }

  /**
   * The live raid. With an arena deployed it is the contract's own answer;
   * otherwise the same rule is applied to headers read straight from hBK.
   */
  loadRaid(force = false) {
    if (force) this.cache.delete('raid');
    return this.cached('raid', 30000, async () => {
      if (this.hasArena) {
        const [raid, len] = await Promise.all([
          this.call(this.net.arena, SEL.currentRaid).then(decodeRaid),
          this.cached('raidLength', Infinity, () => this.call(this.net.arena, SEL.raidLength).then((h) => num(words(h)[0]))),
        ]);
        return { ...raid, raidLength: len, network: this.key };
      }
      const tip = decodeHeader(await this.call(this.net.bitcoinKit, SEL.getLastHeader));
      const raidId = Math.floor(tip.height / RAID_LENGTH);
      const startHeight = raidId * RAID_LENGTH;
      const open = startHeight === tip.height ? tip : decodeHeader(await this.call(this.net.bitcoinKit, encodeCall(SEL.getHeaderN, startHeight)));
      return { raidId, startHeight, seed: open.blockHash, tipHeight: tip.height, raidLength: RAID_LENGTH, network: this.key };
    });
  }

  async leaderboard(raidId) {
    if (!this.hasArena) return null;
    return decodeLeaderboard(await this.call(this.net.arena, encodeCall(SEL.getLeaderboard, raidId)));
  }

  // --------------------------------------------------------- wallet ----

  async connect() {
    const p = this.provider;
    if (!p) throw new HemiError('noWallet', 'No browser wallet found. Install one such as MetaMask or Rabby to submit scores.');
    try {
      const accounts = await p.request({ method: 'eth_requestAccounts' });
      this.account = accounts[0] || null;
      if (!this.watching && p.on) {
        this.watching = true;
        p.on('accountsChanged', (a) => { this.account = a[0] || null; this.emit(); });
        p.on('chainChanged', () => this.emit());
      }
      await this.ensureChain();
      this.emit();
      return this.account;
    } catch (err) {
      throw friendly(err);
    }
  }

  async ensureChain() {
    const p = this.provider;
    const current = await p.request({ method: 'eth_chainId' });
    if (current?.toLowerCase() === this.chainHex) return;
    try {
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: this.chainHex }] });
    } catch (err) {
      const unknown = err?.code === 4902 || err?.data?.originalError?.code === 4902 || /unrecognized|not been added|unknown chain/i.test(err?.message || '');
      if (!unknown) throw err;
      await p.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: this.chainHex,
          chainName: this.net.name,
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: [this.net.rpc],
          blockExplorerUrls: this.net.explorer ? [this.net.explorer] : [],
        }],
      });
    }
  }

  /**
   * Record a run on the arena. `onStatus(stage, hash)` reports 'wallet'
   * (waiting for approval) and 'pending' (sent, waiting to be mined).
   */
  async submitScore({ raidId, score, kills, wave, weapon }, onStatus = () => {}) {
    if (!this.hasArena) throw new HemiError('noArena', 'The leaderboard contract is not deployed on this network yet.');
    try {
      if (!this.account) await this.connect();
      await this.ensureChain();
      const p = this.provider;
      const tx = { from: this.account, to: this.net.arena, data: encodeCall(SEL.submitScore, raidId, score, kills, wave, weapon) };
      // Dry run first so contract errors show up before the wallet prompt.
      await p.request({ method: 'eth_call', params: [tx, 'latest'] });
      const gas = BigInt(await p.request({ method: 'eth_estimateGas', params: [tx] }));
      tx.gas = '0x' + ((gas * 6n) / 5n).toString(16);
      onStatus('wallet');
      const hash = await p.request({ method: 'eth_sendTransaction', params: [tx] });
      onStatus('pending', hash);
      const receipt = await this.waitForReceipt(hash);
      if (receipt.status !== '0x1') throw new HemiError('reverted', 'Hemi rejected the transaction.', { hash });
      this.cache.delete('raid');
      return { hash, url: this.txUrl(hash) };
    } catch (err) {
      throw friendly(err);
    }
  }

  async waitForReceipt(hash, timeoutMs = 120000) {
    const p = this.provider;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const r = await p.request({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => null);
      if (r) return r;
      await new Promise((res) => setTimeout(res, 1500));
    }
    throw new HemiError('timeout', 'The transaction is taking a while. Check it in the explorer.', { hash });
  }
}

/** Short display forms. */
export const shortAddress = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
export const shortHash = (h) => (h ? `${h.slice(0, 22)}…${h.slice(-6)}` : '');
