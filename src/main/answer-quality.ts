import type { Evidence, Generated } from '../shared/documentation';
import type { Retrieval } from '../shared/chat';

export function answerQuality(mode: 'direct' | 'model' | 'insufficient', content: Generated | null, evidence: Evidence[], gaps: string[], retrieval: Retrieval, documentIds: Set<string>) {
  const sources = evidence.map(item => ({ evidenceId: item.id, path: item.path, start: item.start, end: item.end,
    document: documentIds.has(item.id), codebase: true,
    kg: retrieval.edges.some(edge => edge.path === item.path && edge.line >= item.start && edge.line <= item.end),
  }));
  if (mode === 'insufficient' || !content || !evidence.length) return { score: 0, reasons: ['Insufficient evidence for a supported answer.'], sources };
  if (mode === 'direct') return { score: 95, reasons: ['Unique extracted definition with a verified source location.', 'Applies to the location lookup only, not runtime behavior.'], sources };
  const claims = content.sections.flatMap(section => section.claims);
  const uncertain = claims.filter(claim => claim.basis === 'uncertain').length;
  const gapCount = new Set([...gaps, ...content.gaps]).size;
  const kg = sources.some(source => source.kg);
  const score = Math.max(10, 85 - Math.round(20 * uncertain / Math.max(claims.length, 1)) - Math.min(20, gapCount * 5) - (kg ? 10 : 0));
  return { score, reasons: ['Citations and source text passed reference checks; semantic correctness is not measured.',
    `${uncertain}/${claims.length} claims marked uncertain; ${gapCount} reported evidence gaps.`,
    ...(kg ? ['KG lookup used unresolved call relationships.'] : []),
  ], sources };
}
