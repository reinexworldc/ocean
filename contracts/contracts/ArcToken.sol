// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract ArcToken is ERC20, Ownable {
    error ZeroAddress();

    constructor(
        string memory name_,
        string memory symbol_,
        address initialOwner_,
        uint256 initialSupply_
    ) ERC20(name_, symbol_) Ownable(initialOwner_) {
        if (initialOwner_ == address(0)) {
            revert ZeroAddress();
        }

        _mint(initialOwner_, initialSupply_);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) {
            revert ZeroAddress();
        }

        _mint(to, amount);
    }
}
