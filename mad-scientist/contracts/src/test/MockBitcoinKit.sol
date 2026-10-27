// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IBitcoinKit, BitcoinHeader} from "../IBitcoinKit.sol";

/// Stand-in for hBK on local chains: a fake Bitcoin chain whose block hashes
/// are derived from their height. Only for tests and local development.
contract MockBitcoinKit is IBitcoinKit {
    uint32 public tip;

    constructor(uint32 tip_) {
        tip = tip_;
    }

    /// Advance the fake Bitcoin chain by `blocks`.
    function mine(uint32 blocks) external {
        tip += blocks;
    }

    function setTip(uint32 tip_) external {
        tip = tip_;
    }

    function getLastHeader() external view returns (BitcoinHeader memory) {
        return _header(tip);
    }

    function hashOf(uint32 height) public pure returns (bytes32) {
        // Mimic proof-of-work: clear the top 8 bytes like a real block hash.
        return keccak256(abi.encodePacked("btc", height)) >> 64;
    }

    function _header(uint32 height) private pure returns (BitcoinHeader memory h) {
        h.height = height;
        h.blockHash = hashOf(height);
        h.previousBlockHash = height == 0 ? bytes32(0) : hashOf(height - 1);
        h.version = 0x20000000;
        h.timestamp = 1_700_000_000 + height * 600;
        h.bits = 0x17034219;
    }
}
