import { describe, expect, it } from 'vitest';
import { cardSteps } from './AgentActor';

describe('cardSteps', () => {
  it('entrando verso la scrivania: da "to do" a "in progress"', () => {
    expect(cardSteps('todo', true)).toEqual([{ action: 'pick', column: 'todo' }, { action: 'drop', column: 'progress' }]);
  });

  it('andando via: da "in progress" a "in review"', () => {
    expect(cardSteps('progress', false)).toEqual([{ action: 'pick', column: 'progress' }, { action: 'drop', column: 'review' }]);
  });

  it('post-it già in mano: solo da attaccare; già al posto giusto o nessun task: niente', () => {
    expect(cardSteps('carry', true)).toEqual([{ action: 'drop', column: 'progress' }]);
    expect(cardSteps('carry', false)).toEqual([{ action: 'drop', column: 'review' }]);
    expect(cardSteps('progress', true)).toEqual([]);
    expect(cardSteps('review', false)).toEqual([]);
    expect(cardSteps(null, true)).toEqual([]);
  });

  it('agente che riprende il lavoro: da "in review" torna in "in progress"', () => {
    expect(cardSteps('review', true)).toEqual([{ action: 'pick', column: 'review' }, { action: 'drop', column: 'progress' }]);
  });
});
