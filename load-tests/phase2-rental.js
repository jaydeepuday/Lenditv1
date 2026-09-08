import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

const data = new SharedArray('Test Allocations', function () {
    return JSON.parse(open('./phase2-data.json')).renters;
});
const lenderData = JSON.parse(open('./phase2-data.json')).lender;

export const options = {
    scenarios: {
        rental_workflow: {
            executor: 'shared-iterations',
            vus: 100,
            iterations: 2000,
            maxDuration: '2m',
        },
    },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3001/api/v1';

export default function () {
    // Unique data row per iteration across all VUs guarantees 1-to-1 item isolation
    const renter = data[exec.scenario.iterationInTest];
    if (!renter) return;

    const rHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${renter.token}` };
    const lHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${lenderData.token}` };

    // Step 1: POST /borrow (Auth: Renter)
    const borrowRes = http.post(`${BASE_URL}/borrow`, JSON.stringify({ itemId: renter.allocatedItemId, rentalType: 'QUICK' }), { headers: rHeaders, tags: { name: 'borrow_post' } });
    check(borrowRes, { 'Borrow requested (201)': (r) => r.status === 201 });

    // Safety abort if the initial booking failed
    if (borrowRes.status !== 201) return;

    const transactionId = borrowRes.json('data.id');
    if (!transactionId) return;

    // Step 2: PATCH /respond (Auth: Lender)
    const respondRes = http.patch(`${BASE_URL}/borrow/${transactionId}/respond`, JSON.stringify({ action: 'ACCEPTED' }), { headers: lHeaders, tags: { name: 'respond_patch' } });
    check(respondRes, { 'Borrow accepted (200)': (r) => r.status === 200 });

    // Step 3: POST /initiate-checkout (Auth: Renter)
    const initRes = http.post(`${BASE_URL}/borrow/${transactionId}/initiate-checkout`, JSON.stringify({}), { headers: rHeaders, tags: { name: 'initiate_checkout_post' } });
    check(initRes, { 'Checkout initiated (200)': (r) => r.status === 200 });

    // Step 4: POST /pay (Auth: Renter)
    const payRes = http.post(`${BASE_URL}/borrow/${transactionId}/pay`, JSON.stringify({}), { headers: rHeaders, tags: { name: 'pay_post' } });
    check(payRes, { 'Payment successful (200)': (r) => r.status === 200 });
}
