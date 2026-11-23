export interface GhostPrepBillSummary {
  prepBill: Record<string, number>;
  prepBillText: string;
}

/**
 * A build does not terraform. A legal site says so. An illegal site shows the placement block as its reason
 * and no Level / Fill / Grade plan.
 */
export function ghostTerraformReadout(valid: boolean): GhostPrepBillSummary {
  if (!valid) return { prepBill: {}, prepBillText: '' };
  return { prepBill: {}, prepBillText: 'No terraform' };
}
