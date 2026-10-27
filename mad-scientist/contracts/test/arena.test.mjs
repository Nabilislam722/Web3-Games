import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { network } from 'hardhat';

const RAID = 144;
const GRACE = 6;
let ethers, signers;

before(async () => {
  ({ ethers } = await network.create());
  signers = await ethers.getSigners();
});

async function deploy(name, signer, ...args) {
  const c = await ethers.deployContract(name, args, signer);
  await c.waitForDeployment();
  return c;
}

/** Fresh fake Bitcoin chain + arena with the tip at `tip`. */
async function setup(tip = 869_100) {
  const kit = await deploy('MockBitcoinKit', signers[0], tip);
  const arena = await deploy('MadScientistArena', signers[0], await kit.getAddress(), RAID, GRACE);
  return { kit, arena, as: (i) => arena.connect(signers[i]) };
}

// Reverts are checked with staticCall (eth_call), which returns the revert data.
async function expectRevert(promise, arena, name) {
  try {
    await promise;
  } catch (e) {
    const parsed = e.revert || (e.data && arena.interface.parseError(e.data));
    assert.equal(parsed?.name, name, `expected ${name}, got ${parsed?.name ?? e.message}`);
    return parsed;
  }
  assert.fail(`expected revert ${name}`);
}

test('until a raid is opened, its seed follows the newest Bitcoin block', async () => {
  const { kit, arena } = await setup(869_100);
  const r = await arena.currentRaid();
  assert.equal(r.raidId, 869_100n / 144n);
  assert.equal(r.startHeight, 6035n * 144n);
  assert.equal(r.tipHeight, 869_100n);
  assert.equal(r.opened, false);
  assert.equal(r.seed, await kit.hashOf(869_100));
  assert.equal(r.seedHeight, 869_100n);
  assert.ok(r.seed.startsWith('0x0000000000000000'), 'mock hashes look like proof-of-work');
  assert.deepEqual([...(await arena.raidSeed(6035))], [ethers.ZeroHash, 0n]);
  await (await kit.mine(1)).wait();
  assert.equal((await arena.currentRaid()).seed, await kit.hashOf(869_101));
});

test('openRaid locks the seed to the newest Bitcoin block, once', async () => {
  const { kit, arena, as } = await setup(869_100);
  const seed = await kit.hashOf(869_100);
  await expect(as(1).openRaid(), arena, 'RaidOpened', [6035n, 869_100n, seed]);
  await (await kit.mine(3)).wait();
  const rc = await (await as(2).openRaid()).wait();
  assert.equal(rc.logs.length, 0, 'opening again changes nothing');
  const r = await arena.currentRaid();
  assert.deepEqual([r.opened, r.seed, r.seedHeight, r.tipHeight], [true, seed, 869_100n, 869_103n]);
  assert.deepEqual([...(await arena.raidSeed(6035))], [seed, 869_100n]);
});

test('the first score of a raid opens it', async () => {
  const { kit, arena, as } = await setup(869_100);
  await expect(as(1).submitScore(6035, 100, 1, 1, 1), arena, 'RaidOpened', [6035n, 869_100n, await kit.hashOf(869_100)]);
  await (await kit.mine(1)).wait();
  const rc = await (await as(2).submitScore(6035, 200, 1, 1, 1)).wait();
  assert.equal(rc.logs.map((l) => arena.interface.parseLog(l)?.name).join(), 'ScoreSubmitted');
  assert.equal((await arena.currentRaid()).seedHeight, 869_100n);
});

test('a new raid starts every raidLength Bitcoin blocks with a new seed', async () => {
  const { kit, arena, as } = await setup(869_183);
  await (await as(1).openRaid()).wait();
  const a = await arena.currentRaid();
  await (await kit.mine(1)).wait();
  const b = await arena.currentRaid();
  assert.equal(b.raidId, a.raidId + 1n);
  assert.equal(b.opened, false);
  assert.notEqual(b.seed, a.seed);
});

test('submitScore records the run and stamps the Bitcoin height', async () => {
  const { arena, as } = await setup();
  const raid = (await arena.currentRaid()).raidId;
  const player = await signers[1].getAddress();
  await expect(as(1).submitScore(raid, 4200, 31, 7, 3), arena, 'ScoreSubmitted', [raid, player, 4200n, 31n, 7n, 3n, 869_100n]);
  const board = await arena.getLeaderboard(raid);
  assert.equal(board.length, 1);
  assert.deepEqual([board[0].player, board[0].score, board[0].kills, board[0].wave, board[0].weapon, board[0].btcHeight], [player, 4200n, 31n, 7n, 3n, 869_100n]);
  assert.equal(await arena.bestScore(raid, player), 4200n);
});

async function expect(txPromise, contract, event, args) {
  const rc = await (await txPromise).wait();
  const log = rc.logs.map((l) => contract.interface.parseLog(l)).find((l) => l?.name === event);
  assert.ok(log, `missing ${event}`);
  assert.deepEqual([...log.args], args);
}

test('only personal bests are kept, one row per player', async () => {
  const { arena, as } = await setup();
  const raid = (await arena.currentRaid()).raidId;
  await (await as(1).submitScore(raid, 1000, 5, 2, 1)).wait();
  const err = await expectRevert(as(1).submitScore.staticCall(raid, 1000, 9, 3, 1), arena, 'NotImproved');
  assert.equal(err.args[0], 1000n);
  await (await as(1).submitScore(raid, 2500, 12, 4, 2)).wait();
  const board = await arena.getLeaderboard(raid);
  assert.equal(board.length, 1);
  assert.equal(board[0].score, 2500n);
  assert.equal(board[0].weapon, 2n);
});

test('the board stays sorted, capped at 10, ties keep the earlier run', async () => {
  const { arena, as } = await setup();
  const raid = (await arena.currentRaid()).raidId;
  const scores = [500, 900, 700, 900, 100, 1200, 300, 800, 600, 400, 50, 1000];
  for (let i = 0; i < scores.length; i++) await (await as(i + 1).submitScore(raid, scores[i], 1, 1, 1)).wait();
  const board = await arena.getLeaderboard(raid);
  assert.equal(board.length, 10);
  assert.deepEqual(board.map((e) => Number(e.score)), [1200, 1000, 900, 900, 800, 700, 600, 500, 400, 300]);
  // The first 900 came from signer 2, the second from signer 4.
  assert.equal(board[2].player, await signers[2].getAddress());
  assert.equal(board[3].player, await signers[4].getAddress());
  // Climbing from below the cut moves the player up without duplicates.
  await (await as(5).submitScore(raid, 1100, 1, 1, 1)).wait();
  const after = await arena.getLeaderboard(raid);
  assert.deepEqual(after.map((e) => Number(e.score)), [1200, 1100, 1000, 900, 900, 800, 700, 600, 500, 400]);
  assert.equal(new Set(after.map((e) => e.player)).size, 10);
});

test('closed, future and invalid runs are rejected; the grace period is honoured', async () => {
  const { kit, arena, as } = await setup(869_183); // last block of raid 6035
  const raid = 6035;
  await expectRevert(as(1).submitScore.staticCall(raid + 1, 10, 1, 1, 1), arena, 'RaidClosed');
  await expectRevert(as(1).submitScore.staticCall(raid, 0, 1, 1, 1), arena, 'InvalidRun');
  await expectRevert(as(1).submitScore.staticCall(raid, 10, 1, 1, 0), arena, 'InvalidRun');
  await expectRevert(as(1).submitScore.staticCall(raid, 10, 1, 1, 11), arena, 'InvalidRun');
  await expectRevert(as(1).submitScore.staticCall(4294967295, 10, 1, 1, 1), arena, 'RaidClosed');

  await (await kit.mine(GRACE)).wait(); // raid 6036 started GRACE - 1 blocks ago
  await (await as(1).submitScore(raid, 10, 1, 1, 1)).wait();
  // A late run can't open its raid: the newest block already belongs to the next one.
  assert.deepEqual([...(await arena.raidSeed(raid))], [ethers.ZeroHash, 0n]);
  assert.equal((await arena.currentRaid()).opened, false);
  await (await kit.mine(1)).wait(); // grace over
  const err = await expectRevert(as(2).submitScore.staticCall(raid, 10, 1, 1, 1), arena, 'RaidClosed');
  assert.deepEqual([...err.args], [6035n, 6036n]);
  await (await as(2).submitScore(raid + 1, 10, 1, 1, 1)).wait();
});

test('constructor rejects a bad configuration', async () => {
  const kit = await deploy('MockBitcoinKit', signers[0], 1);
  const f = await ethers.getContractFactory('MadScientistArena', signers[0]);
  await assert.rejects(f.deploy(ethers.ZeroAddress, 144, 6));
  await assert.rejects(f.deploy(await kit.getAddress(), 0, 0));
  await assert.rejects(f.deploy(await kit.getAddress(), 144, 144));
});
