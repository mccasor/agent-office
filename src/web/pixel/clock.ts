/**
 * Orologio comune delle animazioni lente della vista 2D (pose, schermi, biliardino): il tempo avanza a scatti di
 * 1/ANIM_HZ s, così tra due scatti i fotogrammi sono identici e il loop di disegno può dormire fino al prossimo
 * cambiamento. Movimento dei personaggi e luci restano sul tempo continuo.
 */

/** scatti al secondo dell'orologio delle animazioni */
export const ANIM_HZ = 8;

/** istante (s) quantizzato allo scatto in corso */
export const tickOf = (now: number): number => Math.floor(now * ANIM_HZ) / ANIM_HZ;

/**
 * Orologio di un fotogramma: dà i fotogrammi delle animazioni all'istante quantizzato `t` e tiene il primo scatto
 * futuro in cui almeno uno di loro cambierà (`next`, Infinity se nulla è animato).
 */
export class AnimClock {
  readonly t: number;
  next = Infinity;

  constructor(now: number) {
    this.t = tickOf(now);
  }

  /** fotogramma floor(t·fps + offset); annota lo scatto in cui passa al successivo */
  frame(fps: number, offset = 0): number {
    const f = Math.floor(this.t * fps + offset);
    // primo scatto da (f+1-offset)/fps in poi; il margine fa svegliare al più uno scatto a vuoto, mai uno in ritardo
    const change = Math.ceil(((f + 1 - offset) / fps) * ANIM_HZ - 1e-6) / ANIM_HZ;
    this.next = Math.min(this.next, change > this.t ? change : this.t + 1 / ANIM_HZ);
    return f;
  }
}

/**
 * Quando ridisegnare dopo un fotogramma all'istante `now` (s): subito (al prossimo requestAnimationFrame) se qualcosa
 * si muove sul tempo continuo, altrimenti al prossimo scatto dell'orologio delle animazioni in cui cambia qualcosa
 * (Infinity: niente di animato, il loop dorme finché non arriva uno snapshot o un input).
 */
export function nextWake(now: number, smooth: boolean, clock: Pick<AnimClock, 'next'>): number {
  return smooth ? now : clock.next;
}
