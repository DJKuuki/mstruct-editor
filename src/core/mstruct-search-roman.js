/** Search validates each figure list independently of the authored chain boundary. */
export function romanFigureValidationSource(source) {
  return source.replace(/\[([^\[\]]*)\]/g, (list, body) => /(?:-x|-)$/.test(body) ? list : `[${body}-x]`);
}

/** Keep the literal source separately; these views add inherited names and
 * make an omitted/- query ending unrestricted while -x stays explicit. */
export function romanFigureSearchViews(source, result, chain, heads) {
  const figure = result?.generalFigure;
  if (!figure) return [];
  const atoms = result.atoms ?? [source];
  const figureIndex = atoms.indexOf(source.slice(figure.start, figure.end));
  if (figureIndex < 0) return [];
  const ownHead = atoms.slice(0, figureIndex);
  if (chain?.index === 0 && !figure.pure) heads?.set(chain.id, ownHead);
  const head = figure.pure ? heads?.get(chain?.id) ?? [] : ownHead;
  const tail = atoms.slice(figureIndex + 1);
  const body = source.slice(figure.start + 1, figure.end - 1).replace(/(?:-x|-)$/, "");
  const endings = figure.link === "break" ? ["", "-", "-x"] : ["", "-"];
  const views = new Map();
  for (const ending of endings) {
    const list = `[${body}${ending}]`;
    for (const prefix of [head, []]) {
      const viewAtoms = [...prefix, list, ...tail];
      const viewSource = viewAtoms.join("");
      views.set(viewSource, { source: viewSource, atoms: viewAtoms });
    }
  }
  return [...views.values()];
}

export function harmonySearchViews(alternative) {
  return [alternative, ...(alternative.romanFigureViews ?? [])];
}
