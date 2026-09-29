/** Minimal event bus so views can react to data changes without a framework. */

const listeners = new Map();

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => off(event, handler);
}

export function once(event, handler) {
  const unsubscribe = on(event, (payload) => {
    unsubscribe();
    handler(payload);
  });
  return unsubscribe;
}

export function off(event, handler) {
  const set = listeners.get(event);
  if (set) set.delete(handler);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (set) {
    for (const handler of Array.from(set)) {
      try { handler(payload); } catch (error) { console.error(`[my crm] "${event}" handler failed`, error); }
    }
  }
  const wildcard = listeners.get('*');
  if (wildcard) {
    for (const handler of Array.from(wildcard)) {
      try { handler({ event, payload }); } catch (error) { console.error('[my crm] wildcard handler failed', error); }
    }
  }
}

export const EVENTS = {
  DATA_CHANGED: 'data:changed',
  VIEW_REFRESH: 'view:refresh',
  OPEN_LEAD: 'lead:open',
  LEAD_UPDATED: 'lead:updated',
  SYNC_DONE: 'sheet:synced',
  AI_STATUS: 'ai:status',
  NOTIFY: 'app:notify',
};
