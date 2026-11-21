// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract MockTarget {
    uint256 public value;
    uint256 public other;
    function setValue(uint256 v) external { value = v; }
    function setOther(uint256 v) external { other = v; }
}
