import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    // Progressively increase load to test the baseline
    stages: [
        { duration: '30s', target: 10 },  // Ramp up to 10 VUs
        { duration: '30s', target: 50 },  // Ramp up to 50 VUs
        { duration: '30s', target: 100 }, // Ramp up to 100 VUs
        { duration: '60s', target: 250 }, // Ramp up to 250 VUs
        { duration: '60s', target: 500 }, // Ramp up to 500 VUs
        { duration: '30s', target: 0 },   // Ramp down to 0 VUs
    ],
    thresholds: {
        http_req_failed: ['rate<0.01'],   // HTTP failure rate below 1%
        http_req_duration: ['p(95)<500'], // p95 latency below 500 ms
    },
};

export default function () {
    const url = 'http://localhost:3001/api/v1/items';

    // Phase 1: Public/read-heavy test on GET /items
    const res = http.get(url);

    // Verify response
    check(res, {
        'status is 200': (r) => r.status === 200,
    });

    // Simulate think time of a real user
    sleep(1);
}
