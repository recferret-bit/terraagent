export type NotificationCategory = 'guild' | 'deed' | 'achievement' | 'stage' | 'combat' | 'system';

export interface NotificationHistoryEntry {
  readonly id: string;
  readonly category: NotificationCategory;
  readonly title: string;
  readonly message: string;
  readonly createdAt: number;
  read: boolean;
  readonly dedupeKey?: string;
  readonly onSelect?: () => void;
}

export interface PushNotificationInput {
  category: NotificationCategory;
  title: string;
  message: string;
  dedupeKey?: string;
  createdAt?: number;
  onSelect?: () => void;
}

const MAX_HISTORY = 80;
let seq = 0;
let entries: NotificationHistoryEntry[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* listener fault isolated */
    }
  }
}

export function pushNotification(input: PushNotificationInput): NotificationHistoryEntry {
  const text = input.message.trim();
  const title = input.title.trim() || input.category.toUpperCase();
  if (input.dedupeKey) {
    const existing = entries.find((e) => e.dedupeKey === input.dedupeKey);
    if (existing) return existing;
  }
  const entry: NotificationHistoryEntry = {
    id: `notif_${++seq}_${Date.now()}`,
    category: input.category,
    title,
    message: text,
    createdAt: input.createdAt ?? Date.now(),
    read: false,
    dedupeKey: input.dedupeKey,
    onSelect: input.onSelect,
  };
  entries = [entry, ...entries].slice(0, MAX_HISTORY);
  notify();
  return entry;
}

export function getNotificationHistory(): readonly NotificationHistoryEntry[] {
  return entries;
}

export function getUnreadNotificationCount(): number {
  let count = 0;
  for (const e of entries) if (!e.read) count++;
  return count;
}

export function markNotificationRead(id: string): boolean {
  const item = entries.find((e) => e.id === id);
  if (!item || item.read) return false;
  item.read = true;
  notify();
  return true;
}

export function markAllNotificationsRead(): void {
  let changed = false;
  for (const e of entries) {
    if (!e.read) {
      e.read = true;
      changed = true;
    }
  }
  if (changed) notify();
}

export function removeNotification(id: string): boolean {
  const before = entries.length;
  entries = entries.filter((e) => e.id !== id);
  if (entries.length !== before) {
    notify();
    return true;
  }
  return false;
}

export function clearNotifications(): void {
  entries = [];
  notify();
}

export function resetNotificationsForTests(): void {
  seq = 0;
  entries = [];
  listeners.clear();
}

export function subscribeNotifications(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
