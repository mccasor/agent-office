import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentVerdict } from '../../shared/types';
import { t } from '../../shared/i18n';
import { clockText, verdictText } from './labels';
import { useNow } from './useNow';
import './hud.css';

/** Esito di "Controlla stato": il verdetto, l'agente che il server non conosce più, o il server che non risponde. */
export type CheckResult = { kind: 'verdict'; verdict: AgentVerdict } | { kind: 'missing' } | { kind: 'error' };

/** Chiede al server un verdetto aggiornato su un subagente (GET /api/agents/<id>/status, in sola lettura). */
export async function fetchVerdict(agentId: string): Promise<CheckResult> {
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/status`, { cache: 'no-store' });
    if (res.status === 404) return { kind: 'missing' };
    if (!res.ok) return { kind: 'error' };
    return { kind: 'verdict', verdict: (await res.json()) as AgentVerdict };
  } catch {
    return { kind: 'error' };
  }
}

/** Stato di "Controlla stato" per un agente: l'ultimo esito (azzerato se cambia agente), se è in corso e il controllo. */
export function useStatusCheck(agentId: string): { result: CheckResult | null; loading: boolean; check: () => void } {
  const [state, setState] = useState<{ id: string; result: CheckResult | null; loading: boolean }>({ id: agentId, result: null, loading: false });
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const check = useCallback(() => {
    setState({ id: agentId, result: null, loading: true });
    void fetchVerdict(agentId).then((result) => {
      // la risposta di un agente di prima (scheda cambiata nel frattempo) non vale
      if (live.current) setState((s) => (s.id === agentId ? { id: agentId, result, loading: false } : s));
    });
  }, [agentId]);
  const current = state.id === agentId ? state : { result: null, loading: false };
  return { result: current.result, loading: current.loading, check };
}

/** Pulsante "Controlla stato" ("Controllo…" mentre aspetta il server). */
export function CheckButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button type="button" className="hud-action" title={t('check.hint')} disabled={loading} onClick={onClick}>
      {loading ? t('check.loading') : t('check.button')}
    </button>
  );
}

/**
 * Riquadro del verdetto: titolo, spiegazione e ora del controllo; per "probabilmente finito senza notifica", con
 * `onMarkDone`, il pulsante "Segna come terminato", l'unico modo di nascondere a mano un agente.
 */
export function VerdictNote({ result, onMarkDone }: { result: CheckResult; onMarkDone?: () => void }) {
  const now = useNow();
  if (result.kind !== 'verdict') {
    return (
      <div className="hud-verdict hud-verdict--error" role="status">
        <p>{t(result.kind === 'missing' ? 'verdict.missing' : 'verdict.error')}</p>
      </div>
    );
  }
  const v = result.verdict;
  const { title, lines } = verdictText(v, now);
  return (
    <div className={`hud-verdict hud-verdict--${v.kind}`} role="status" data-verdict={v.kind}>
      <p className="hud-verdict__title">{title}</p>
      {lines.map((line) => <p key={line}>{line}</p>)}
      <p className="hud-verdict__at hud-muted">{t('verdict.checkedAt', { time: clockText(v.checkedAt) })}</p>
      {v.kind === 'silent' && onMarkDone && (
        <button type="button" className="hud-action" title={t('marked.hint')} onClick={onMarkDone}>{t('marked.button')}</button>
      )}
    </div>
  );
}

/**
 * "Controlla stato" nella scheda di un subagente (#104): il pulsante e, dopo il controllo, il verdetto. Per un
 * terminato (`done`) niente pulsante; resta il verdetto già dato, così "Chiuso" si legge anche dopo che l'agente,
 * chiuso proprio da quel controllo, risulta terminato.
 */
export function StatusCheck({ agentId, done = false, onMarkDone }: { agentId: string; done?: boolean; onMarkDone?: () => void }) {
  const { result, loading, check } = useStatusCheck(agentId);
  if (done && !result) return null;
  return (
    <div className="hud-check">
      {!done && <CheckButton loading={loading} onClick={check} />}
      {result && <VerdictNote result={result} onMarkDone={done ? undefined : onMarkDone} />}
    </div>
  );
}
