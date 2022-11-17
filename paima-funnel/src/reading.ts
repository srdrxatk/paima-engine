import type Web3 from 'web3';
import type { BlockTransactionString } from 'web3-eth';
import type { Contract, EventData } from 'web3-eth-contract';
import pkg from 'web3-utils';

import type { ChainData, SubmittedChainData } from '@paima/utils';
import { doLog } from '@paima/utils';

import { processDataUnit } from './batch-processing.js';

const { hexToUtf8 } = pkg;

interface PromiseFulfilledResult<T> {
  status: 'fulfilled';
  value: T;
}

async function getSubmittedData(
  web3: Web3,
  block: BlockTransactionString,
  events: EventData[]
): Promise<SubmittedChainData[]> {
  const eventMapper = (e: EventData): Promise<SubmittedChainData[]> => {
    const data: string = e.returnValues.data;
    const decodedData = data && data.length > 0 ? hexToUtf8(data) : '';
    return processDataUnit(
      web3,
      {
        userAddress: e.returnValues.userAddress,
        inputData: decodedData,
        inputNonce: '',
      },
      block.number
    );
  };

  const unflattenedList = await Promise.all(events.map(eventMapper));
  return unflattenedList.flat();
}

async function processBlock(
  blockNumber: number,
  web3: Web3,
  storage: Contract
): Promise<ChainData> {
  try {
    const [block, events] = await Promise.all([
      web3.eth.getBlock(blockNumber),
      storage.getPastEvents('PaimaGameInteraction', {
        fromBlock: blockNumber,
        toBlock: blockNumber,
      }),
    ]);

    return {
      timestamp: block.timestamp,
      blockHash: block.hash,
      blockNumber: block.number,
      submittedData: await getSubmittedData(web3, block, events),
    };
  } catch (err) {
    doLog(`[funnel::processBlock] caught ${err}`);
    throw err;
  }
}

export async function internalReadDataMulti(
  web3: Web3,
  storage: Contract,
  fromBlock: number,
  toBlock: number
): Promise<ChainData[]> {
  if (toBlock < fromBlock) {
    return [];
  }
  let blockPromises: Promise<ChainData>[] = [];
  for (let i = fromBlock; i <= toBlock; i++) {
    const block = processBlock(i, web3, storage);
    const timeoutBlock = timeout(block, 5000);
    blockPromises.push(timeoutBlock);
  }
  return await Promise.allSettled(blockPromises).then(resList => {
    let firstRejected = resList.findIndex(elem => elem.status === 'rejected');
    if (firstRejected < 0) {
      firstRejected = resList.length;
    }
    return resList
      .slice(0, firstRejected)
      .map(elem => (elem as PromiseFulfilledResult<ChainData>).value);
  });
}

export async function internalReadDataSingle(
  web3: Web3,
  storage: Contract,
  fromBlock: number
): Promise<ChainData> {
  return await processBlock(fromBlock, web3, storage);
}

// Timeout function for promises
export const timeout = <T>(prom: Promise<T>, time: number): Promise<Awaited<T>> =>
  Promise.race([prom, new Promise<T>((_resolve, reject) => setTimeout(reject, time))]);
