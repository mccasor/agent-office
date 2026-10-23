import type { TokenUsage } from '../../shared/types';
import { effectiveInput, formatCost, formatTokens } from './format';
import { Row } from './panels';

/** "Output 3.4k · Input effettivo 91k": input effettivo = input + scrittura in cache (la lettura costa poco). */
export const tokenText = (t: TokenUsage): string => `Output ${formatTokens(t.output)} · Input effettivo ${formatTokens(effectiveInput(t))}`;

/**
 * Sezione dei token (`title`): in breve e, con `cost`, il costo stimato; con `details` il dettaglio (input, cache read,
 * cache creation e la parte da 1 ora) in un riquadro chiuso. Con i token nascosti dalle impostazioni (`showTokens`)
 * resta il costo; senza nemmeno quello la sezione non c'è, titolo compreso.
 */
export function TokenSummary({ title, tokens, cost, costTestId, details = true, showTokens = true }: {
  title?: string;
  tokens: TokenUsage;
  cost?: number | null;
  costTestId?: string;
  details?: boolean;
  showTokens?: boolean;
}) {
  if (!showTokens && cost === undefined) return null;
  const parts: [key: string, label: string, value: number][] = [
    ['input', 'Input', tokens.input],
    ['cacheRead', 'Cache read', tokens.cacheRead],
    ['cacheCreation', 'Cache creation', tokens.cacheCreation],
  ];
  if (tokens.cacheCreation1h) parts.push(['cacheCreation1h', 'di cui cache da 1 h', tokens.cacheCreation1h]);
  return (
    <>
      {title && <div className="hud-card__section hud-muted">{title}</div>}
      <dl>
        {showTokens && (
          <Row label="Token">
            <span data-testid="tokens-summary">{tokenText(tokens)}</span>
          </Row>
        )}
        {cost !== undefined && (
          <Row label="Costo stimato">
            <span data-testid={costTestId}>{formatCost(cost)}</span>
          </Row>
        )}
      </dl>
      {details && showTokens && (
        <details className="hud-tokens">
          <summary className="hud-muted">Dettaglio token</summary>
          <dl className="hud-breakdown">
            {parts.map(([key, text, value]) => (
              <Row key={key} label={text}>
                <span data-testid={`tokens-${key}`}>{formatTokens(value)}</span>
              </Row>
            ))}
          </dl>
        </details>
      )}
    </>
  );
}
