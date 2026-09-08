import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';

const data = new SharedArray('Test Allocations', function () {
    return JSON.parse(open('./phase2-data.json')).renters;
});
// Grab the very first item to use as the centralized contention target
const targetItemId = JSON.parse(open('./phase2-data.json')).renters[0].allocatedItemId;

export const options = {
    scenarios: {
        concurrency_attack: {
            executor: 'per-vu-iterations',
            vus: 50,
            iterations: 1, // each VU fires exactly ONCE simultaneously
            maxDuration: '10s',
        },
    },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3001/api/v1';

export default function () {
    // Each VU gets a totally unique, verified renter account with a loaded wallet
    const renter = data[__VU - 1];
    if (!renter) return;

    const rHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${renter.token}` };

    // ATTACK: All 50 VUs blast POST /borrow simultaneously for the EXACT SAME targetItem
    const borrowRes = http.post(`${BASE_URL}/borrow`, JSON.stringify({ itemId: targetItemId, rentalType: 'QUICK' }), { headers: rHeaders });

    // Only ONE request should win out and get 201. The rest should get exactly 409 Conflict.
    check(borrowRes, {
        'Success (201)': (r) => r.status === 201,
        'Conflict (409) Overlap Prevented': (r) => r.status === 409
    });
}
