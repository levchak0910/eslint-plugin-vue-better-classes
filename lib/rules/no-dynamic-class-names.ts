import { isString } from "lodash";
import type { VAttribute, VDirective } from "vue-eslint-parser/ast";
import type { AST } from "vue-eslint-parser";
import type {
  ArrayExpression,
  ConditionalExpression,
  ObjectExpression,
  SpreadElement,
  Expression,
} from "eslint-plugin-vue/util-types/ast";

import * as utils from "../utils/vue";
import * as regexpUtils from "../utils/regexp";
import type { RuleContext, RuleListener } from "../types";

function getName(attribute: VAttribute | VDirective): string | null {
  if (!attribute.directive) {
    return attribute.key.name;
  }
  if (attribute.key.name.name === "bind") {
    return (
      (attribute.key.argument &&
        attribute.key.argument.type === "VIdentifier" &&
        attribute.key.argument.name) ||
      null
    );
  }
  return null;
}

function isSatisfyList(list: string[], item: string): boolean {
  let itemSatisfies = list.includes(item);

  if (itemSatisfies) return true;

  const regexpItems = list
    .filter(regexpUtils.isRegExp)
    .map((reg) => regexpUtils.toRegExp(reg));

  for (const regexp of regexpItems) {
    if (regexp.test(item)) {
      itemSatisfies = true;
      break;
    }
  }

  return itemSatisfies;
}

function withProps(
  context: RuleContext,
  bodyVisitor: (propNames: string[]) => RuleListener,
): RuleListener {
  const allowProps = context.options[0]?.allowProps || false;

  const propNames: string[] = ["class"];

  if (allowProps === false) {
    return bodyVisitor(propNames);
  }

  return utils.compositingVisitors(
    utils.defineScriptSetupVisitor(context, {
      onDefinePropsEnter(_, props) {
        propNames.push(...props.map((p) => p.propName).filter(isString));
      },
    }) as RuleListener,
    utils.defineVueVisitor(context, {
      onVueObjectEnter(node) {
        const props = utils.getComponentPropsFromOptions(node);
        propNames.push(...props.map((p) => p.propName).filter(isString));
      },
    }),
    bodyVisitor(propNames),
  );
}

export = {
  meta: {
    docs: {
      description: "disallow dynamic class names usage",
      categories: [],
      default: "error",
      url: "https://github.com/levchak0910/eslint-plugin-vue-kebab-class-naming/rules/no-dynamic-class-names.html",
    },
    fixable: null,
    messages: {
      dynamic: "No dynamic class.",
    },
    schema: [
      {
        type: "object",
        properties: {
          classAttrNames: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
            additionalItems: true,
          },
          allowConditional: {
            type: "boolean",
          },
          allowProps: {
            type: "boolean",
          },
        },
        additionalProperties: false,
      },
    ],
    type: "problem",
  },
  create(context: RuleContext): RuleListener {
    if (!context.parserServices.defineTemplateBodyVisitor) return {};

    const names = [...(context.options[0]?.classAttrNames || [])];
    const allowConditional = context.options[0]?.allowConditional || false;

    if (!names.includes("class")) names.push("class");

    function report(node: AST.HasLocation) {
      context.report({
        node,
        loc: node.loc,
        messageId: "dynamic",
      });
    }

    function reportDynamicInSpread(
      spread: SpreadElement,
      allowedProps: string[],
    ) {
      if (spread.argument.type === "ArrayExpression") {
        return reportDynamicInArray(spread.argument, allowedProps);
      }

      if (spread.argument.type === "ObjectExpression") {
        return reportDynamicInObject(spread.argument, allowedProps);
      }

      return report(spread.argument);
    }

    function reportDynamicInObject(
      object: ObjectExpression,
      allowedProps: string[],
    ) {
      for (const property of object.properties) {
        if (property.type === "SpreadElement") {
          reportDynamicInSpread(property, allowedProps);
          continue;
        }

        if (property.shorthand) {
          continue;
        }

        if (property.computed || property.method) {
          report(property);
          continue;
        }

        if (property.key.type === "Identifier" && isString(property.key.name)) {
          continue;
        }

        if (utils.isStringLiteral(property.key)) {
          continue;
        }

        if (property.value.type === "Identifier") {
          continue;
        }

        reportDynamicInExpression(property.value, allowedProps);
      }
    }

    function reportDynamicInArray(
      array: ArrayExpression,
      allowedProps: string[],
    ) {
      for (const element of array.elements) {
        if (element === null) continue;

        if (element.type === "SpreadElement") {
          reportDynamicInSpread(element, allowedProps);
          continue;
        }

        reportDynamicInExpression(element, allowedProps);
      }
    }

    function reportDynamicInConditional(
      conditional: ConditionalExpression,
      allowedProps: string[],
    ) {
      reportDynamicInExpression(conditional.alternate, allowedProps);
      reportDynamicInExpression(conditional.consequent, allowedProps);
    }

    function reportDynamicInExpression(
      expression: Expression,
      allowedProps: string[],
    ): void | RuleListener {
      if (expression === null) return;

      if (
        expression.type === "Literal" &&
        typeof expression.value === "string"
      ) {
        return;
      }

      if (
        expression.type === "Identifier" &&
        allowedProps.includes(expression.name)
      ) {
        return;
      }

      if (
        expression.type === "MemberExpression" &&
        expression.object.type === "Identifier" &&
        ["$props", "$attrs"].includes(expression.object.name) &&
        expression.property.type === "Identifier" &&
        allowedProps.includes(expression.property.name)
      ) {
        return;
      }

      if (expression.type === "ObjectExpression") {
        reportDynamicInObject(expression, allowedProps);
        return;
      }

      if (expression.type === "ArrayExpression") {
        reportDynamicInArray(expression, allowedProps);
        return;
      }

      if (expression.type === "ConditionalExpression" && allowConditional) {
        reportDynamicInConditional(expression, allowedProps);
        return;
      }

      report(expression);
    }

    function reportDynamic(
      attribute: VAttribute | VDirective,
      allowedProps: string[],
    ) {
      if (attribute.value === null) {
        return;
      }

      if (attribute.value.type === "VLiteral") {
        return;
      }

      if (attribute.value.expression === null) {
        return;
      }

      reportDynamicInExpression(
        attribute.value.expression as Expression,
        allowedProps,
      );
    }

    return withProps(context, (props) =>
      context.parserServices.defineTemplateBodyVisitor({
        VAttribute(node: VAttribute) {
          const name = getName(node);

          if (name === null || !isSatisfyList(names, name)) {
            return;
          }

          reportDynamic(node, props);
        },
      }),
    );
  },
};
