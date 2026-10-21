export type { Cell, Seat, OfficeLayout, Desk } from './layout';
export { createLayout, deskCells, plantCells, cellToWorld, cellKey, MIN_SEATS } from './layout';
export { findPath, isWalkable } from './path';
export { assignSeats, seatsByDoorDistance } from './seats';
export type { PathPosition } from './motion';
export { advanceAlongPath, pathLength, WALK_SPEED } from './motion';
export type { Motion } from './AgentActor';
export { Office } from './Office';
export { AgentActor } from './AgentActor';
