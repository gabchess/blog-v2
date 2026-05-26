# ADR-410: Quadratic Funding CLR Implementation Patterns

## Status
Proposed

## Context
We are implementing a QF (Quadratic Funding) simulator using Capital Constrained Liberal Radicalism (CLR) for educational purposes. The phase 1 implementation requires type definitions and validation schemas for rounds, projects, votes, and CLR calculation results.

Key questions:
1. What is the canonical CLR formula and how should we implement it?
2. How do production systems structure their data models?
3. What edge cases must we handle?
4. What precision should we use for calculations?

## Research Findings

### Web Sources

**The CLR Formula:**
```
For each project p:
  raw_match[p] = (sum of sqrt(contributions))^2 - sum(contributions)

When total_raw_match > matching_pool:
  scaling_factor = matching_pool / total_raw_match
  final_match[p] = raw_match[p] * scaling_factor
```

This is the standard formula from the original Liberal Radicalism paper by Buterin, Hitzig, and Weyl.

**Critical Implementation Bug (clr.fund lesson):**
- Wrong: `allocation = (votes_for_project / total_votes) * matching_pool`
- Correct: Square root aggregation THEN squaring
- This error caused $16k misallocation in a $350k round

Sources:
- [WTF is Quadratic Funding](https://www.wtfisqf.com/)
- [clr.fund Updated QF Implementation](https://blog.clr.fund/updated-qf-implementation/)

### Expert Opinions (Twitter/X)

**Vitalik Buterin:** Co-authored the original formula. Advocates for pairwise coordination subsidies for anti-collusion in production systems.

**Kevin Owocki (Gitcoin):** "Quadratic funding weighs votes of people with more capital less than projects with many small contributions." Evolved Gitcoin to use COCM (Connection-Oriented Cluster Matching).

**Consensus:** For educational demos, basic CLR is sufficient. Anti-collusion (pairwise/COCM) is needed only for production systems handling real money.

### Production Examples (GitHub)

**1. [gitcoinco/pluralistic.js](https://github.com/gitcoinco/pluralistic.js)** (97.7% TypeScript)
```typescript
interface Contribution {
  sender: string;
  recipient: string;
  amount: bigint;
}

interface Calculation {
  contributorCount: number;
  totalReceived: bigint;
  sumOfSqrtContributions: bigint;
  matchedAmount: bigint;
}
```

**2. [LoremLabs/quadratic-funding](https://github.com/LoremLabs/quadratic-funding)**
```typescript
interface Project {
  identifier: string;
  match: number;
  contributions: Contribution[];
}
```

**Pattern observed:** Most implementations store contributions separately from projects, aggregating at calculation time.

### Official Guidance

**Edge Cases (documented in Gitcoin's clr.py):**
1. **Zero contributions:** Skip matching entirely, return 0
2. **Single contributor:** Match = 0 (since `(sqrt(c))^2 - c = 0`)
3. **NaN results:** Default to 0 to prevent cascading errors

**Precision:**
- Gitcoin uses Python's arbitrary precision
- TypeScript implementations use `bigint` with Babylonian sqrt
- For educational demo with small amounts, standard JS numbers are adequate

**Capital Constraint Handling:**
```javascript
// Proportional scaling (most common)
if (totalRawMatch > matchingPool) {
  scalingFactor = matchingPool / totalRawMatch;
  finalMatch = rawMatch * scalingFactor;
}
```

## Decision

For our educational QF simulator:

### Data Model Structure
```typescript
// Matches production patterns from gitcoinco/pluralistic.js
interface Round {
  id: string;
  name: string;
  matchingPool: number;
  voterBudget: number;
  status: 'setup' | 'voting' | 'closed';
  projects: Project[];
  voterCodes: VoterCode[];
  votes: Vote[];
  results?: CLRResults;
}

interface Vote {
  voterCode: string;
  allocations: Record<string, number>; // projectId -> amount
}

interface CLRResults {
  projects: ProjectResult[];
  totalRawMatch: number;
  scalingFactor: number;
  matchingPoolUsed: number;
}
```

### CLR Calculation
```typescript
function calculateCLR(round: Round): CLRResults {
  for (const project of round.projects) {
    let directSum = 0;
    let sqrtSum = 0;

    for (const vote of round.votes) {
      const amount = vote.allocations[project.id] ?? 0;
      if (amount > 0) {
        directSum += amount;
        sqrtSum += Math.sqrt(amount);
      }
    }

    // CLR formula: (sum of sqrt)^2 - direct sum
    const rawMatch = Math.max(0, sqrtSum * sqrtSum - directSum);
    // ...
  }

  // Apply capital constraint
  const scalingFactor = totalRawMatch > matchingPool
    ? matchingPool / totalRawMatch
    : 1;
}
```

### Precision Choice
- Use standard JavaScript numbers (64-bit float)
- Adequate for educational demo with amounts < 10,000
- No external dependencies needed

### Validation Schemas (Zod)
```typescript
export const CreateRoundInputSchema = z.object({
  name: z.string().min(1).max(100),
  matchingPool: z.number().positive(),
  voterBudget: z.number().positive(),
});

export const SubmitVoteInputSchema = z.object({
  voterCode: z.string().min(1),
  allocations: z.record(z.string(), z.number().nonnegative()),
});
```

## Consequences

### Positive
- Follows production-proven patterns from Gitcoin
- Simple formula implementation (no anti-collusion complexity)
- Standard types easily understood by learners
- Edge cases handled explicitly

### Negative
- Standard JS numbers may lose precision with very large amounts
- No anti-collusion protection (acceptable for demo)
- Single-contributor edge case produces zero matching (may confuse users)

### Trade-offs
- **Simplicity over completeness:** We implement basic CLR without pairwise/COCM. This is appropriate for an educational demo where trust is assumed.
- **JS numbers over bigint:** Simpler code, adequate precision for demo scale. Would need revision for production.

## References
- [Liberal Radicalism Paper](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3243656)
- [WTF is Quadratic Funding](https://www.wtfisqf.com/)
- [gitcoinco/pluralistic.js](https://github.com/gitcoinco/pluralistic.js)
- [gitcoinco/quadratic-funding](https://github.com/gitcoinco/quadratic-funding)
- [clr.fund Updated Implementation](https://blog.clr.fund/updated-qf-implementation/)
- [Pairwise Coordination Subsidies](https://ethresear.ch/t/pairwise-coordination-subsidies-a-new-quadratic-funding-design/5553)
