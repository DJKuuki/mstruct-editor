export function symbolModelDom(model, ownerDocument) {
  if (typeof model === "string") return ownerDocument.createTextNode(model);
  const node = ownerDocument.createElement(model.tag);
  node.className = model.className;
  for (const [name, value] of Object.entries(model.attrs)) node.setAttribute(name, value);
  node.append(...model.children.map((child) => symbolModelDom(child, ownerDocument)));
  return node;
}
