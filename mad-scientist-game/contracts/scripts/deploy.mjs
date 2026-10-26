// Deploy MadScientistArena to Hemi.
//
//   PRIVATE_KEY=0x... npm run deploy -- testnet
//   PRIVATE_KEY=0x... npm run deploy -- mainnet
//
// Optional: RPC_URL (another provider), RAID_LENGTH (Bitcoin blocks per raid,
// default 144), GRACE_BLOCKS (late submissions allowed, default 6).
import { ethers } from 'ethers';
import { compile } from './compile.mjs';
import { HEMI_NETWORKS } from '../../js/hemi-config.js';

const key = process.argv[2] || 'testnet';
const net = HEMI_NETWORKS[key];
if (!net || key === 'local') {
  console.error('Usage: PRIVATE_KEY=0x... npm run deploy -- <testnet|mainnet>');
  process.exit(1);
}
if (!process.env.PRIVATE_KEY) {
  console.error('Set PRIVATE_KEY to the deployer account. It needs a little ETH on ' + net.name + ' for gas.');
  process.exit(1);
}
const raidLength = Number(process.env.RAID_LENGTH || 144);
const grace = Number(process.env.GRACE_BLOCKS || 6);

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || net.rpc, net.chainId, { staticNetwork: true });
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const C = compile();

// Check hVM answers through hBK before spending gas.
const kit = new ethers.Contract(net.bitcoinKit, [
  'function getLastHeader() view returns (tuple(uint32 height, bytes32 blockHash, uint32 version, bytes32 previousBlockHash, bytes32 merkleRoot, uint32 timestamp, uint32 bits, uint32 nonce))',
], provider);
const tip = await kit.getLastHeader();
console.log(`${net.name}: hVM sees Bitcoin block ${tip.height} (${tip.blockHash})`);

const balance = await provider.getBalance(wallet.address);
console.log(`Deployer ${wallet.address} has ${ethers.formatEther(balance)} ETH`);
if (balance === 0n) {
  console.error(`No ETH for gas. Bridge some to ${net.name} first (https://app.hemi.xyz/en/tunnel/).`);
  process.exit(1);
}

const factory = new ethers.ContractFactory(C.MadScientistArena.abi, C.MadScientistArena.bytecode, wallet);
const arena = await factory.deploy(net.bitcoinKit, raidLength, grace);
console.log(`Deploying… tx ${arena.deploymentTransaction().hash}`);
await arena.waitForDeployment();
const address = await arena.getAddress();
const raid = await arena.currentRaid();

console.log(`
MadScientistArena deployed at ${address}
${net.explorer}/address/${address}
Live raid #${raid.raidId}, seeded by Bitcoin block ${raid.startHeight}.

Paste the address into js/hemi-config.js:
  ${key}: { ..., arena: '${address}' }`);
