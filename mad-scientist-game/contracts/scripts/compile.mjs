// Compile the contracts with solc-js (no native toolchain needed).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function sources(dir) {
  const out = {};
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) Object.assign(out, sources(p));
    else if (name.endsWith('.sol')) out[relative(SRC, p)] = { content: readFileSync(p, 'utf8') };
  }
  return out;
}

/** Returns { ContractName: { abi, bytecode } } for every contract in src/. */
export function compile() {
  const input = {
    language: 'Solidity',
    sources: sources(SRC),
    settings: {
      // Shanghai bytecode runs on Hemi and on local test chains alike.
      evmVersion: 'shanghai',
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  for (const w of output.errors || []) console.warn(w.formattedMessage);
  const contracts = {};
  for (const file of Object.values(output.contracts)) {
    for (const [name, c] of Object.entries(file)) contracts[name] = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
  }
  return contracts;
}
