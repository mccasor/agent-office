import { useEffect, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import type { WorkArea } from '../../shared/types';
import { BOARD_COLUMNS, cellToWorld, type BoardColumn, type OfficeLayout } from './layout';

/** Dove sta il post-it di un task: su una board, oppure in mano all'agente che lo sta spostando. */
export type CardPlace = BoardColumn | 'carry';

export interface TaskCard {
  /** agentId */
  id: string;
  title: string;
  issues: number[];
  area: WorkArea;
  place: CardPlace;
}

const BOARD_TITLE: Record<BoardColumn, string> = { todo: 'TO DO', progress: 'IN PROGRESS', review: 'IN REVIEW' };
const BOARD_ACCENT: Record<BoardColumn, string> = { todo: '#8d99ae', progress: '#e9a23b', review: '#43aa8b' };

/** colori pastello dei post-it, per area di lavoro */
const NOTE_COLOR: Record<WorkArea, string> = {
  backend: '#ffd166',
  frontend: '#a0e7e5',
  architecture: '#ffaebc',
  test: '#b4f8c8',
  docs: '#fbe7c6',
  devops: '#cdb4db',
  research: '#bde0fe',
  other: '#fff3b0',
};

const BOARD_W = 1.7;
const BOARD_H = 1.35;
const BOARD_Y = 0.65;
const HEADER_H = 0.2;
export const NOTE_SIZE = 0.4;
const NOTE_COLS = 3;
const NOTE_ROWS = 3;
/** post-it visibili per board: i più recenti */
export const NOTES_PER_BOARD = NOTE_COLS * NOTE_ROWS;

const WALL_FACE = 0.17;
const box = new THREE.BoxGeometry(1, 1, 1);
const plane = new THREE.PlaneGeometry(1, 1);
const frame = new THREE.MeshStandardMaterial({ color: '#232325', roughness: 0.6 });
const cork = new THREE.MeshStandardMaterial({ color: '#f7f7f4', roughness: 0.9 });

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Testo a capo su al più `maxLines` righe larghe `width` px, con ellissi finale. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (line && lines.length === maxLines) lines[maxLines - 1] = `${lines[maxLines - 1]!.replace(/.$/, '')}…`;
  return lines;
}

/** Post-it quadrato con numero di issue e titolo del task (origine al centro, faccia verso +z). */
export function PostIt({ card, size = NOTE_SIZE }: { card: Pick<TaskCard, 'title' | 'issues' | 'area'>; size?: number }): ReactNode {
  const { title, area } = card;
  const issues = card.issues.join(' ');
  const material = useMemo(() => {
    const map = canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = NOTE_COLOR[area];
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(0, 0, 128, 14);
      ctx.fillStyle = '#2b2b2b';
      let y = 36;
      if (issues) {
        ctx.font = 'bold 24px system-ui, sans-serif';
        ctx.fillText(issues.split(' ').map((n) => `#${n}`).join(' '), 8, y);
        y += 24;
      }
      ctx.font = '600 17px system-ui, sans-serif';
      for (const l of wrap(ctx, title, 112, issues ? 3 : 5)) {
        ctx.fillText(l, 8, y);
        y += 20;
      }
    });
    return new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : NOTE_COLOR[area], map, roughness: 0.9 });
  }, [title, issues, area]);
  useEffect(() => () => {
    material.map?.dispose();
    material.dispose();
  }, [material]);
  return <mesh geometry={plane} material={material} scale={[size, size, 1]} castShadow />;
}

function BoardHeader({ column }: { column: BoardColumn }): ReactNode {
  const material = useMemo(() => {
    const map = canvasTexture(256, 32, (ctx) => {
      ctx.fillStyle = BOARD_ACCENT[column];
      ctx.fillRect(0, 0, 256, 32);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(BOARD_TITLE[column], 128, 23);
    });
    return new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : BOARD_ACCENT[column], map, roughness: 0.8 });
  }, [column]);
  return <mesh geometry={plane} material={material} scale={[BOARD_W, HEADER_H, 1]} />;
}

/** Tre board (to do, in progress, in review) appese alla parete nord, con i post-it dei task degli agenti. */
export function TaskBoards({ layout, cards }: { layout: OfficeLayout; cards: TaskCard[] }): ReactNode {
  const [, , zWall] = cellToWorld(layout, { x: 0, z: 0 });
  return (
    <group>
      {BOARD_COLUMNS.map((column) => {
        const [x] = cellToWorld(layout, layout.boards[column].cell);
        const notes = cards.filter((c) => c.place === column).slice(-NOTES_PER_BOARD);
        return (
          <group key={column} position={[x, BOARD_Y, zWall + WALL_FACE]}>
            <mesh geometry={box} material={frame} position={[0, BOARD_H / 2, 0.01]} scale={[BOARD_W + 0.08, BOARD_H + 0.08, 0.03]} castShadow />
            <mesh geometry={box} material={cork} position={[0, BOARD_H / 2, 0.025]} scale={[BOARD_W, BOARD_H, 0.01]} />
            <group position={[0, BOARD_H - HEADER_H / 2, 0.032]}>
              <BoardHeader column={column} />
            </group>
            {notes.map((card, i) => {
              const col = i % NOTE_COLS;
              const row = Math.floor(i / NOTE_COLS);
              const nx = -BOARD_W / 2 + (col + 0.5) * (BOARD_W / NOTE_COLS);
              const ny = BOARD_H - HEADER_H - 0.06 - (row + 0.5) * ((BOARD_H - HEADER_H - 0.1) / NOTE_ROWS);
              return (
                <group key={card.id} position={[nx, ny, 0.034]} rotation-z={((i * 7) % 5 - 2) * 0.03}>
                  <PostIt card={card} />
                </group>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}
