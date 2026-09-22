import http from 'node:http';
import { encodeUint256, encodeBool, padUint256 } from './evm.mjs';

/**
 * Creates a lightweight mock server handling EVM JSON-RPC (eth_blockNumber, eth_call)
 * and Consensus Layer Beacon REST endpoints with real EVM byte serialization.
 */
export function createMockRpcServer(routes = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Execution Layer JSON-RPC endpoint
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      try {
        const json = JSON.parse(body);

        if (json.method === 'eth_blockNumber') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: json.id,
            result: routes.executionBlockHex ?? '0x2625a0' // 2500000
          }));
          return;
        }

        if (json.method === 'eth_call') {
          // Serialize Megapool tuple:
          // (beaconIndex, stateCode, exitNotified, balanceFinalized, dissolved, dissolutionEpoch, lastDistributionTime)
          const state = routes.megapoolValidatorState ?? {
            beaconIndex: 10044,
            stateCode: 3, // exit_in_progress
            exitNotified: false,
            balanceFinalized: false,
            dissolved: false,
            dissolutionEpoch: 0,
            lastDistributionTime: 1758500000
          };

          const rawBytes = '0x' +
            padUint256(state.beaconIndex ?? 0) +
            padUint256(state.stateCode ?? 2) +
            padUint256(state.exitNotified ? 1 : 0) +
            padUint256(state.balanceFinalized ? 1 : 0) +
            padUint256(state.dissolved ? 1 : 0) +
            padUint256(state.dissolutionEpoch ?? 0) +
            padUint256(state.lastDistributionTime ?? 0);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: json.id,
            result: rawBytes
          }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: null }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // Consensus Layer Beacon REST endpoints
    if (req.method === 'GET') {
      if (url.pathname === '/eth/v1/beacon/headers/finalized') {
        if (routes.beaconUnavailable) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Service Unavailable' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: {
            header: {
              message: {
                slot: String(routes.finalizedSlot ?? '30400') // Epoch 950
              }
            }
          }
        }));
        return;
      }

      if (url.pathname.startsWith('/eth/v1/beacon/states/finalized/validators/')) {
        if (routes.beaconUnavailable) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Service Unavailable' }));
          return;
        }

        const validatorParam = decodeURIComponent(url.pathname.split('/').pop());

        if (routes.validatorNotFound || validatorParam === 'not-found' || validatorParam === '99') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 404, message: 'Validator not found' }));
          return;
        }

        const validatorData = routes.beaconValidator ?? {
          index: '10044',
          status: 'withdrawal_possible',
          validator: {
            pubkey: '0x888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888',
            withdrawal_credentials: routes.withdrawalCredentials ?? '0x0100000000000000000000001111111111111111111111111111111111111111',
            activation_epoch: '800',
            exit_epoch: '920',
            withdrawable_epoch: '945',
            slashed: routes.slashed ?? false
          }
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: validatorData }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
  });

  return {
    server,
    listen: () => new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        resolve(`http://127.0.0.1:${port}`);
      });
    }),
    close: () => new Promise((resolve) => {
      server.close(resolve);
    })
  };
}
