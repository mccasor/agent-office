import type { TokenUsage } from '../../shared/types';
import { formatTokens } from './format';

const PARTS = [
  ['input', 'Input'],
  ['output', 'Output'],
  ['cacheRead', 'Cache read'],
  ['cacheCreation', 'Cache creation'],
  ['total', 'Totale'],
] as const;

/** Ripartizione dei token: input, output, cache read, cache creation e totale. */
export function TokenBreakdown({ tokens }: { tokens: TokenUsage }) {
  return (
    <dl className="hud-breakdown">
      {PARTS.map(([key, label]) => (
        <div className="hud-row" key={key}>
          <dt>{label}</dt>
          <dd data-testid={`tokens-${key}`}>{formatTokens(tokens[key])}</dd>
        </div>
      ))}
    </dl>
  );
}
