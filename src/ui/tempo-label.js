export function createTempoLabels({ makeElement, makeDurationNotes, parseFraction, tr }) {
  function makeTempoNote(unit) {
    const duration = parseFraction(unit);
    const note = duration ? makeDurationNotes(duration, unit, makeElement, tr("durationAria", { duration: unit })) : null;
    if (note) note.classList.add("bpm-note");
    return note ?? makeElement("span", "bpm-note", unit);
  }

  function makeBpmLabel(value) {
    const [unit = "1/4", tempo = ""] = value.split("=").map((part) => part.trim());
    const label = makeElement("span", "bpm-label");
    label.append(makeTempoNote(unit));
    label.append(makeElement("span", "bpm-equals", "="));
    label.append(makeElement("span", "bpm-value", tempo));
    return label;
  }

  function makeMetricModulationLabel(value) {
    const [from = "1/4", to = "1/4"] = String(value ?? "").split("=").map((part) => part.trim());
    const label = makeElement("span", "bpm-label metric-modulation-label");
    label.append(makeTempoNote(from), makeElement("span", "bpm-equals", "="), makeTempoNote(to));
    return label;
  }

  return { makeBpmLabel, makeMetricModulationLabel };
}
