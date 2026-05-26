# QF Simulator

An educational demo of **Quadratic Funding** using the Capital Constrained Liberal Radicalism (CLR) algorithm.

## What is Quadratic Funding?

Quadratic Funding is a mechanism for democratically allocating matching funds to public goods. The key insight: **many small contributions from different people generate more matching than a few large contributions**.

The formula:
```
Match = (Σ√contributions)² - Σcontributions
```

This incentivizes projects to seek broad community support rather than relying on wealthy patrons.

## Quick Start

```bash
# From the repo root, start both the REST API and QF Simulator
pnpm dev --filter @octant/rest --filter @octant/qf-simulator
```

This starts:
- **REST API** on http://localhost:4000 (backend)
- **QF Simulator** on http://localhost:3003 (frontend)

Open http://localhost:3003 in your browser.

## How to Use

### As Admin

1. **Create a Round** - Set the matching pool (e.g., 1000) and voter budget (e.g., 100)
2. **Add Projects** - Add 2+ projects that will compete for funding
3. **Generate Voter Codes** - Create codes to distribute to voters
4. **Open Voting** - Once ready, open the round for voting

### As Voter

1. Switch to **Voter** view using the nav button
2. Enter your voter code
3. Allocate your budget across projects
4. Watch the **live preview** show how your allocation affects matching
5. Submit your vote

### View Results

After the admin closes the round:
- See per-project breakdown: direct contributions, raw match, scaled match, total
- Understand the scaling factor if matching demand exceeded the pool
- Read the CLR formula explanation

## The CLR Algorithm

When you vote:
1. Your direct contribution goes to the project
2. The **matching** is calculated as: `(sum of square roots)² - sum of contributions`
3. If total matching demand exceeds the pool, all matches are **scaled down** proportionally

Example:
- Project A gets $10 from 3 different voters → Match ≈ $60
- Project B gets $30 from 1 voter → Match = $0

Same total ($30), but Project A gets way more matching because it has broader support.

## Development

```bash
# Typecheck
pnpm --filter @octant/qf-simulator typecheck

# Build
pnpm --filter @octant/qf-simulator build

# Run E2E tests (API only)
pnpm --filter @octant/rest test:e2e
```

## Architecture

- **Frontend**: React 19 + Vite on port 3003
- **Backend**: REST API on port 4000 (same server as auth endpoints)
- **State**: In-memory (rounds are ephemeral - restarting the server clears data)
- **No auth**: Voter codes provide simple access control without authentication

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/qf/rounds` | POST | Create a new round |
| `/qf/rounds/current` | GET | Get current round |
| `/qf/rounds/current/projects` | POST | Add a project |
| `/qf/rounds/current/codes` | POST | Generate voter codes |
| `/qf/rounds/current/status` | POST | Change round status |
| `/qf/rounds/current/votes` | POST | Submit/update a vote |
| `/qf/rounds/current/preview` | POST | Preview CLR with hypothetical vote |
| `/qf/rounds/current/close` | POST | Close round and calculate results |
