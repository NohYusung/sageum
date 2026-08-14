export type RuleGraphLink = {
  left_rule_id: string;
  right_rule_id: string;
};

/**
 * Keep graph traversal anchored to documents and limited to one rule hop, while
 * still drawing every persisted edge between the rule nodes that made it into
 * that one-hop subgraph.
 */
export function selectOneHopRuleGraph<T extends RuleGraphLink>(
  links: T[],
  directlyVisibleRuleIds: ReadonlySet<string>,
) {
  const anchorLinks = links.filter((link) => (
    directlyVisibleRuleIds.has(link.left_rule_id)
    || directlyVisibleRuleIds.has(link.right_rule_id)
  ));
  const includedRuleIds = new Set(directlyVisibleRuleIds);
  for (const link of anchorLinks) {
    includedRuleIds.add(link.left_rule_id);
    includedRuleIds.add(link.right_rule_id);
  }
  const visibleLinks = links.filter((link) => (
    includedRuleIds.has(link.left_rule_id)
    && includedRuleIds.has(link.right_rule_id)
  ));
  return { includedRuleIds, visibleLinks };
}
