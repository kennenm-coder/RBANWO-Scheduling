/**
 * Who is signed in, readable from the data layer.
 *
 * The store functions that change availability rules, company blocks and hard
 * deletes have no React context, and threading an actor through every caller
 * (including call sites another change is editing) is how audit trails end up
 * with gaps. AuthProvider publishes the current actor here; activity-store.ts
 * reads it when it records an event.
 */

export interface CurrentActor {
  id: string | null;
  name: string | null;
}

let current: CurrentActor = { id: null, name: null };

export function setCurrentActor(actor: CurrentActor): void {
  current = actor;
}

export function getCurrentActor(): CurrentActor {
  return current;
}
