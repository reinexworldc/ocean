import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, parseUnits } from "viem";

describe("ArcToken", async function () {
  const { viem } = await network.create();

  it("mints the initial supply to the owner", async function () {
    const [owner] = await viem.getWalletClients();
    const initialSupply = parseUnits("1000000", 18);

    const token = await viem.deployContract("ArcToken", [
      "Arc Test Token",
      "ATT",
      owner.account.address,
      initialSupply,
    ]);

    assert.equal(await token.read.name(), "Arc Test Token");
    assert.equal(await token.read.symbol(), "ATT");
    assert.equal(await token.read.owner(), getAddress(owner.account.address));
    assert.equal(await token.read.totalSupply(), initialSupply);
    assert.equal(
      await token.read.balanceOf([owner.account.address]),
      initialSupply,
    );
  });

  it("allows the owner to mint more tokens", async function () {
    const [owner, recipient] = await viem.getWalletClients();
    const initialSupply = parseUnits("100", 18);
    const mintedAmount = parseUnits("25", 18);

    const token = await viem.deployContract("ArcToken", [
      "Arc Test Token",
      "ATT",
      owner.account.address,
      initialSupply,
    ]);

    await token.write.mint([recipient.account.address, mintedAmount]);

    assert.equal(await token.read.totalSupply(), initialSupply + mintedAmount);
    assert.equal(
      await token.read.balanceOf([recipient.account.address]),
      mintedAmount,
    );
  });
});
