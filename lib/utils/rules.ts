import type { Rule } from "../types";

const baseRules = [
  {
    rule: require("../rules/no-dynamic-class-names"),
    ruleName: "no-dynamic-class-names",
    ruleId: "vue-kebab-class-naming/no-dynamic-class-names",
  },
];

export const rules = baseRules.map((obj) => {
  const rule = obj.rule;
  rule.meta.docs.ruleName = obj.ruleName;
  rule.meta.docs.ruleId = obj.ruleId;
  return rule as Rule;
});

/**
 * Collect the rules
 * @returns {Array} rules
 */
export function collectRules(): {
  [key: string]: string;
} {
  return rules.reduce(
    (obj, rule) => {
      if (!rule.meta.deprecated) {
        obj[rule.meta.docs.ruleId || ""] = rule.meta.docs.default || "error";
      }
      return obj;
    },
    {} as { [key: string]: string },
  );
}
