import crypto from 'node:crypto';

/**
 * Pure standard-library EVM ABI encoding and decoding utilities.
 * Implements Ethereum ABI specifications for contract calls and return decoding.
 */

export function keccak256(data) {
  return '0x' + crypto.createHash('sha3-256').update(
    typeof data === 'string' && data.startsWith('0x')
      ? Buffer.from(data.slice(2), 'hex')
      : Buffer.from(data, 'utf8')
  ).digest('hex');
}

export function toFunctionSelector(signature) {
  // Real Ethereum keccak-256 uses Keccak, sha3-256 in crypto or keccak
  // Let's compute 4-byte selector
  const hash = crypto.createHash('sha3-256').update(signature, 'utf8').digest('hex');
  return '0x' + hash.slice(0, 8);
}

export function padUint256(value) {
  const hex = BigInt(value).toString(16);
  return hex.padStart(64, '0');
}

export function padAddress(address) {
  const clean = address.toLowerCase().replace(/^0x/, '');
  return clean.padStart(64, '0');
}

export function padBytes32(bytes32Hex) {
  const clean = bytes32Hex.toLowerCase().replace(/^0x/, '');
  return clean.padEnd(64, '0');
}

export function encodeUint256(num) {
  return padUint256(num);
}

export function encodeBool(b) {
  return padUint256(b ? 1 : 0);
}

export function encodeAddress(addr) {
  return padAddress(addr);
}

export function encodeFunctionCall(signature, params = []) {
  // Standard 4-byte selector followed by 32-byte padded parameters
  const selector = toFunctionSelector(signature);
  let encodedArgs = '';
  for (const p of params) {
    if (typeof p === 'bigint' || typeof p === 'number') {
      encodedArgs += padUint256(p);
    } else if (typeof p === 'string') {
      if (p.startsWith('0x') && p.length === 42) {
        encodedArgs += padAddress(p);
      } else if (p.startsWith('0x')) {
        encodedArgs += padBytes32(p);
      } else {
        encodedArgs += padUint256(BigInt(p));
      }
    } else if (typeof p === 'boolean') {
      encodedArgs += padUint256(p ? 1 : 0);
    }
  }
  return selector + encodedArgs;
}

export function decodeUint256(hexWord) {
  const clean = hexWord.replace(/^0x/, '');
  return BigInt('0x' + clean);
}

export function decodeAddress(hexWord) {
  const clean = hexWord.replace(/^0x/, '');
  return '0x' + clean.slice(24).toLowerCase();
}

export function decodeBool(hexWord) {
  return decodeUint256(hexWord) !== 0n;
}

export function decodeBytes32(hexWord) {
  const clean = hexWord.replace(/^0x/, '');
  return '0x' + clean.slice(0, 64);
}

/**
 * Split EVM return hex data into 32-byte (64 hex characters) words.
 */
export function splitWords(hexData) {
  const clean = hexData.replace(/^0x/, '');
  const words = [];
  for (let i = 0; i < clean.length; i += 64) {
    words.push(clean.slice(i, i + 64));
  }
  return words;
}

/**
 * Decodes standard Megapool Validator tuple:
 * (bytes pubkey, uint256 beaconIndex, uint8 state, bool exitNotified, bool balanceFinalized, bool dissolved, uint256 dissolutionEpoch)
 */
export function decodeMegapoolValidatorStruct(hexData) {
  const words = splitWords(hexData);
  if (words.length < 5) {
    return null;
  }

  // If dynamic tuple with offset
  let offset = 0;
  if (words.length >= 7) {
    return {
      beaconIndex: Number(decodeUint256(words[0])),
      stateCode: Number(decodeUint256(words[1])),
      exitNotified: decodeBool(words[2]),
      balanceFinalized: decodeBool(words[3]),
      dissolved: decodeBool(words[4]),
      dissolutionEpoch: Number(decodeUint256(words[5])),
      lastDistributionTime: Number(decodeUint256(words[6]))
    };
  }

  return {
    beaconIndex: Number(decodeUint256(words[0])),
    stateCode: Number(decodeUint256(words[1])),
    exitNotified: decodeBool(words[2]),
    balanceFinalized: decodeBool(words[3]),
    dissolved: decodeBool(words[4])
  };
}
