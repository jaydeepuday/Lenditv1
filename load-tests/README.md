# LendIT Load Tests

This directory contains Grafana k6 scripts to load-test the LendIT backend.

## 1. Installation

If you don't have Grafana k6 installed, download and install it from the [official website](https://k6.io/docs/get-started/installation/) or using your package manager:
- **macOS:** `brew install k6`
- **Windows (Winget):** `winget install k6`
- **Windows (Chocolatey):** `choco install k6`

## 2. Start the Backend

To properly run load tests, you MUST start the backend in load-test mode to bypass the NestJS global rate limiter (which normally blocks anything over 60 req/min).

**Option 1: Using your .env file**
Add `LOAD_TEST=true` to your backend `.env` file, then start the server:
```bash
cd apps/backend
npm run dev
```

**Option 2: Using the terminal (Windows PowerShell)**
```powershell
cd apps/backend
$env:LOAD_TEST="true"; npm run dev
```

## 3. Verify Backend

Before running the test, confirm the items endpoint is successfully returning an HTTP 200 response:
```bash
curl -I http://localhost:3001/api/v1/items
```

## 4. Run the Test

To execute Phase 1 (public endpoint baseline test), navigate to the `load-tests` folder and run:
```bash
k6 run phase1.js
```

## 5. Send Back Metrics

After the test finishes, copy the k6 terminal output (the final summary) and send it for analysis. I will specifically look at the following metrics:
- **http_reqs:** Total requests and Requests/sec 
- **http_req_duration:** Average, p(50), p(95), and p(99) latencies
- **http_req_failed:** The HTTP error rate
- **vus:** Maximum concurrent virtual users reached
