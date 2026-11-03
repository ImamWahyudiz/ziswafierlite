/**
 * Classifier evaluation harness: scores a classify function against labelled cases.
 * Case = { label, amount, expect: { layer?, coa?, notCoa?: number[], quarantine?: boolean, evidence?: string } }
 */
const QUARANTINE_LAYER = "UNAUTHORIZED_FALLBACK";

export function evaluate(cases, master, classify) {
  let decided = 0;
  let quarantined = 0;
  const wrongCases = [];
  for (const c of cases) {
    const r = classify({ id: "eval", rawDate: "2026-01-01", rawLabel: c.label, rawAmount: c.amount }, master);
    const isQuarantine = !r.matchedLayer || r.matchedLayer === QUARANTINE_LAYER;
    if (isQuarantine) quarantined++; else decided++;
    const e = c.expect || {};
    const problems = [];
    if (e.quarantine === true && !isQuarantine) problems.push("expected quarantine");
    if (e.quarantine === false && isQuarantine) problems.push("expected a decision");
    if (e.layer !== undefined && r.matchedLayer !== e.layer) problems.push(`layer ${r.matchedLayer} != ${e.layer}`);
    if (e.coa !== undefined && Number(r.assignedCoa) !== e.coa) problems.push(`coa ${r.assignedCoa} != ${e.coa}`);
    if (e.notCoa && e.notCoa.includes(Number(r.assignedCoa))) problems.push(`coa ${r.assignedCoa} forbidden`);
    if (e.evidence !== undefined && r.evidence?.type !== e.evidence) problems.push(`evidence ${r.evidence?.type} != ${e.evidence}`);
    if (problems.length) wrongCases.push(`${c.label} [${c.amount}]: ${problems.join("; ")}`);
  }
  const total = cases.length;
  const wrong = wrongCases.length;
  return {
    total, decided, quarantined, wrong, wrongCases,
    coverage: total ? decided / total : 0,
    precision: decided ? Math.max(0, decided - wrong) / decided : 1
  };
}
