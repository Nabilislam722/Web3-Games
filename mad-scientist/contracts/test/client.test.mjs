// Tests the game's dependency-free Hemi client (js/hemi.js) against ethers'
// ABI implementation and a local chain running the real contracts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { ethers } from 'ethers';
import {
  SEL, Hemi, HemiError, encodeCall, decodeHeader, decodeRaid, decodeLeaderboard, decodeRevert, revertData,
} from '../../js/hemi.js';
import { HEMI_NETWORKS } from '../../js/hemi-config.js';

let server, conn, provider, signers, kit, arena;
const ARENA = () => arena.interface;
const KIT = () => kit.interface;

before(async () => {
  // hemi.js talks JSON-RPC over HTTP, so serve an in-process chain.
  server = await network.createServer('default', '127.0.0.1');
  const url = `http://127.0.0.1:${(await server.listen()).port}`;
  conn = await network.create({ network: 'localhost', override: { url } });
  provider = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true, cacheTimeout: -1 });
  signers = await Promise.all([0, 1, 2].map((i) => provider.getSigner(i)));
  kit = await conn.ethers.deployContract('MockBitcoinKit', [869_100]);
  arena = await conn.ethers.deployContract('MadScientistArena', [await kit.getAddress(), 144, 6]);
  await arena.waitForDeployment();
  Object.assign(HEMI_NETWORKS.local, { rpc: url, bitcoinKit: await kit.getAddress(), arena: await arena.getAddress() });
});

after(async () => {
  provider?.destroy();
  await conn?.close();
  await server?.close();
});

/** Minimal EIP-1193 wallet backed by the local chain's unlocked account. */
function fakeWallet(index) {
  return {
    async request({ method, params }) {
      if (method === 'eth_requestAccounts') return [await signers[index].getAddress()];
      if (method === 'wallet_switchEthereumChain') return null;
      return provider.send(method, params || []);
    },
  };
}

function client(index) {
  const h = new Hemi('local');
  Object.defineProperty(h, 'provider', { get: () => fakeWallet(index) });
  return h;
}

test('selectors match keccak256 of each signature', () => {
  const sigs = {
    getLastHeader: 'getLastHeader()', currentRaid: 'currentRaid()', raidLength: 'raidLength()',
    getLeaderboard: 'getLeaderboard(uint32)', bestScore: 'bestScore(uint32,address)', submitScore: 'submitScore(uint32,uint32,uint32,uint16,uint8)',
  };
  for (const [k, sig] of Object.entries(sigs)) assert.equal(SEL[k], ethers.id(sig).slice(0, 10), sig);
});

test('call encoding matches ethers', () => {
  assert.equal(encodeCall(SEL.submitScore, 6035, 123456, 42, 7, 3), ARENA().encodeFunctionData('submitScore', [6035, 123456, 42, 7, 3]));
  const player = '0x' + 'ab'.repeat(20);
  assert.equal(encodeCall(SEL.bestScore, 6035, player), ARENA().encodeFunctionData('bestScore', [6035, player]));
});

test('return decoding matches ethers', () => {
  const hash = '0x00000000000000000001b6e3a51d6c1f4c4b5e8e1a9f5d2a3c4b5e6f7a8b9c0d';
  const header = [869_040, hash, 0x20000000, '0x' + '11'.repeat(32), '0x' + '22'.repeat(32), 1_730_000_000, 0x17034219, 2_880_000_123];
  const enc = KIT().encodeFunctionResult('getLastHeader', [header]);
  assert.deepEqual(decodeHeader(enc), {
    height: 869_040, blockHash: hash, version: 0x20000000, previousBlockHash: header[3], merkleRoot: header[4],
    timestamp: 1_730_000_000, bits: 0x17034219, nonce: 2_880_000_123,
  });
  assert.deepEqual(
    decodeRaid(ARENA().encodeFunctionResult('currentRaid', [6035, 869_040, hash, 869_100, 869_050, true])),
    { raidId: 6035, startHeight: 869_040, seed: hash, tipHeight: 869_100, seedHeight: 869_050, opened: true },
  );
  assert.equal(decodeRaid(ARENA().encodeFunctionResult('currentRaid', [6035, 869_040, hash, 869_100, 869_100, false])).opened, false);
  const a = '0x' + 'ab'.repeat(20), b = '0x' + 'cd'.repeat(20);
  const board = ARENA().encodeFunctionResult('getLeaderboard', [[[a, 900, 30, 9, 4, 869_101], [b, 500, 12, 3, 1, 869_120]]]);
  assert.deepEqual(decodeLeaderboard(board), [
    { player: a, score: 900, kills: 30, wave: 9, weapon: 4, btcHeight: 869_101 },
    { player: b, score: 500, kills: 12, wave: 3, weapon: 1, btcHeight: 869_120 },
  ]);
  assert.deepEqual(decodeLeaderboard(ARENA().encodeFunctionResult('getLeaderboard', [[]])), []);
});

test('revert data is found in wallet- and node-shaped errors and decoded', () => {
  const closed = ARENA().encodeErrorResult('RaidClosed', [6034, 6035]);
  const notImproved = ARENA().encodeErrorResult('NotImproved', [4200]);
  assert.equal(revertData({ code: -32603, data: { originalError: { code: 3, data: closed } } }), closed); // MetaMask
  assert.equal(revertData({ data: { hash: null, result: notImproved } }), notImproved); // ganache estimateGas
  assert.equal(revertData({ code: 3, data: closed }), closed);
  assert.deepEqual(decodeRevert(closed), { name: 'RaidClosed', args: [6034, 6035] });
  assert.deepEqual(decodeRevert(notImproved), { name: 'NotImproved', args: [4200] });
  assert.deepEqual(decodeRevert(new ethers.Interface(['error Error(string)']).encodeErrorResult('Error', ['bad config'])), { name: 'Error', args: ['bad config'] });
  assert.equal(revertData({ message: 'network down' }), null);
});

test('loadRaid reads the live raid from the arena', async () => {
  const raid = await new Hemi('local').loadRaid();
  const onChain = await arena.currentRaid();
  assert.equal(raid.raidId, Number(onChain.raidId));
  assert.equal(raid.seed, onChain.seed);
  assert.equal(raid.raidLength, 144);
  assert.equal(raid.tipHeight, 869_100);
  assert.deepEqual([raid.seedHeight, raid.opened], [869_100, false]);
});

test('without an arena, loadRaid derives the same unopened raid straight from hBK', async () => {
  const saved = HEMI_NETWORKS.local.arena;
  HEMI_NETWORKS.local.arena = '';
  try {
    const raid = await new Hemi('local').loadRaid();
    const onChain = await arena.currentRaid();
    assert.equal(onChain.opened, false);
    assert.equal(raid.raidId, Number(onChain.raidId));
    assert.equal(raid.startHeight, Number(onChain.startHeight));
    assert.equal(raid.seed, onChain.seed);
    assert.equal(raid.seedHeight, Number(onChain.seedHeight));
    assert.equal(raid.opened, false);
  } finally {
    HEMI_NETWORKS.local.arena = saved;
  }
});

test('submitScore goes through the wallet and lands on the leaderboard', async () => {
  const h = client(1);
  const raid = await h.loadRaid();
  const stages = [];
  const res = await h.submitScore({ raidId: raid.raidId, score: 7777, kills: 40, wave: 8, weapon: 6 }, (s) => stages.push(s));
  assert.match(res.hash, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(stages, ['wallet', 'pending']);
  const board = await h.leaderboard(raid.raidId);
  assert.equal(board[0].player.toLowerCase(), (await signers[1].getAddress()).toLowerCase());
  assert.deepEqual([board[0].score, board[0].kills, board[0].wave, board[0].weapon, board[0].btcHeight], [7777, 40, 8, 6, 869_100]);
  // The first score opened the raid, so its seed is now locked.
  await (await kit.mine(1)).wait();
  const after = await h.loadRaid();
  assert.deepEqual([after.opened, after.seed, after.seedHeight, after.tipHeight], [true, raid.seed, 869_100, 869_101]);
});

test('contract errors become clear messages before any transaction is sent', async () => {
  const h = client(1);
  const raid = await h.loadRaid();
  await assert.rejects(h.submitScore({ raidId: raid.raidId, score: 100, kills: 1, wave: 1, weapon: 1 }), (e) => {
    assert.ok(e instanceof HemiError);
    assert.equal(e.code, 'notImproved');
    assert.match(e.message, /7,777/);
    return true;
  });
  await assert.rejects(h.submitScore({ raidId: raid.raidId - 1, score: 100, kills: 1, wave: 1, weapon: 1 }), (e) => e.code === 'raidClosed');
  const noWallet = new Hemi('local');
  Object.defineProperty(noWallet, 'provider', { get: () => null });
  await assert.rejects(noWallet.connect(), (e) => e.code === 'noWallet');
});

test('a wallet rejection is reported as cancelled', async () => {
  const h = new Hemi('local');
  Object.defineProperty(h, 'provider', {
    get: () => ({ request: async ({ method }) => { if (method === 'eth_requestAccounts') throw Object.assign(new Error('User rejected'), { code: 4001 }); } }),
  });
  await assert.rejects(h.connect(), (e) => e.code === 'rejected');
});
