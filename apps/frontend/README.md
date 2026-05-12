# LendIT Frontend (Vanilla)

A minimal, vanilla HTML/CSS/JavaScript frontend for the LendIT campus lending platform.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Single-page shell (navbar, error banner, spinner) |
| `styles.css` | Complete design system |
| `main.js` | Router, page renderers, event handlers, state |
| `api.js` | All backend API calls, error handling, token refresh |
| `assets/LendIT.png` | Logo |

## Running Locally

### 1. Start the backend

```bash
cd apps/backend
npm run start:dev
```

Backend runs at `http://localhost:3001/api/v1`.

### 2. Serve the frontend

Any static file server works. Examples:

```bash
# Using npx serve (easiest)
cd apps/frontend-vanilla
npx -y serve .

# Or Python
cd apps/frontend-vanilla
python -m http.server 3000

# Or VS Code Live Server extension
# Right-click index.html → Open with Live Server
```

### 3. Open in browser

Go to `http://localhost:3000` (or whichever port your server uses).

## Configuration

The backend base URL is set in `api.js`:

```js
const API_BASE = 'http://localhost:3001/api/v1';
```

Change this if your backend runs on a different host/port.

## CORS

Make sure the backend's `FRONTEND_URL` env variable matches your frontend URL (default: `http://localhost:3000`).
