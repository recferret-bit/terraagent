const MAX_APPROVED = 4096;
const approvedOrders = new Set<string>();

export function markWalletSignedOrder(commandId: string): void {
  const trimmed = commandId.trim();
  if (!trimmed) return;
  if (approvedOrders.size >= MAX_APPROVED) {
    const first = approvedOrders.values().next().value;
    if (first) approvedOrders.delete(first);
  }
  approvedOrders.add(trimmed);
}

export function hasWalletSignedOrder(commandId?: string | null): boolean {
  if (!commandId) return false;
  return approvedOrders.has(commandId.trim());
}

export function clearWalletSignedOrdersForTests(): void {
  approvedOrders.clear();
}
