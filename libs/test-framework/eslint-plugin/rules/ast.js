export function isThisPage(node) {
  return (
    node?.type === "MemberExpression" &&
    node.object?.type === "ThisExpression" &&
    node.property?.type === "Identifier" &&
    node.property.name === "page"
  );
}

export function getMemberName(node) {
  if (node?.type !== "MemberExpression") {
    return null;
  }

  if (node.property?.type === "Identifier") {
    return node.property.name;
  }

  if (node.property?.type === "Literal" && typeof node.property.value === "string") {
    return node.property.value;
  }

  return null;
}

export function isAllowedPageCall(node, allowedMethods) {
  const memberName = getMemberName(node);
  return Boolean(memberName && allowedMethods.has(memberName));
}
