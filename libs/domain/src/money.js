export function applyRounding(value, mode) {
    if (mode === "FLOOR")
        return Math.floor(value);
    if (mode === "CEIL")
        return Math.ceil(value);
    return Math.round(value);
}
export function bpsAmount(baseNtd, bps) {
    return (baseNtd * bps) / 10_000;
}
export function permilleAmount(baseNtd, permilleRate) {
    return (baseNtd * permilleRate) / 1_000;
}
//# sourceMappingURL=money.js.map
