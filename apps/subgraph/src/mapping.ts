import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  OctantToken,
  Transfer as TransferEvent,
  Approval as ApprovalEvent,
} from "../generated/OctantToken/OctantToken";
import { Transfer, Approval, TokenStats } from "../generated/schema";

export function handleTransfer(event: TransferEvent): void {
  let id = event.transaction.hash.concatI32(event.logIndex.toI32());

  let entity = new Transfer(id);
  entity.from = event.params.from;
  entity.to = event.params.to;
  entity.value = event.params.value;
  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();

  // Update singleton TokenStats with current totalSupply and decimals
  let statsId = "token-stats";
  let stats = TokenStats.load(statsId);
  if (stats == null) {
    stats = new TokenStats(statsId);
    stats.decimals = 0;
    stats.totalSupply = BigInt.zero();
  }

  let contract = OctantToken.bind(event.address);

  let totalSupplyResult = contract.try_totalSupply();
  if (!totalSupplyResult.reverted) {
    stats.totalSupply = totalSupplyResult.value;
  }

  let decimalsResult = contract.try_decimals();
  if (!decimalsResult.reverted) {
    stats.decimals = decimalsResult.value;
  }

  stats.save();
}

export function handleApproval(event: ApprovalEvent): void {
  let id = event.transaction.hash.concatI32(event.logIndex.toI32());

  let entity = new Approval(id);
  entity.owner = event.params.owner;
  entity.spender = event.params.spender;
  entity.value = event.params.value;
  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}
