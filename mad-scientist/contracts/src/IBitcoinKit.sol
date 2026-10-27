// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// Bitcoin block header as returned by the Hemi Bitcoin Kit (hBK).
/// `blockHash` is in the usual display order (leading zeros first).
struct BitcoinHeader {
    uint32 height;
    bytes32 blockHash;
    uint32 version;
    bytes32 previousBlockHash;
    bytes32 merkleRoot;
    uint32 timestamp;
    uint32 bits;
    uint32 nonce;
}

/// The part of hBK this game uses. hBK wraps Hemi's hVM precompiles, which read
/// Bitcoin state from the Bitcoin node embedded in every Hemi node.
/// Deployed at 0x7007dd1C09527B92AEcd8Ae6570B73d09E0B8F12 (mainnet)
/// and 0x181dBA19ce25bbD6d884347d2471FE5E5C0fcA4c (testnet).
interface IBitcoinKit {
    /// Latest Bitcoin header known to hVM (precompile 0x44).
    function getLastHeader() external view returns (BitcoinHeader memory);
}
