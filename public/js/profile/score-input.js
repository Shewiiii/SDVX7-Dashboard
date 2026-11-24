export const maxScore = 10000000;
const scoreStep = 25000;

export function formatScoreInput(score) {
    return String(score).replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
}

export function parseScore(value) {
    const digits = value.replace(/[\s,]/g, "");
    return /^-?\d+$/.test(digits) ? Number(digits) : NaN;
}

export function stepScore(score, direction) {
    return Math.max(0, Math.min(maxScore, score + direction * scoreStep));
}

export function writeScoreInput(input, score, { preserveCaret = false } = {}) {
    const digitsBeforeCaret = input.value
        .slice(0, input.selectionStart)
        .replace(/\D/g, "").length;
    input.value = formatScoreInput(score);
    input.setAttribute("aria-valuenow", score);
    if (preserveCaret && document.activeElement === input) {
        let caret = 0,
            digits = 0;
        while (caret < input.value.length && digits < digitsBeforeCaret) {
            if (/\d/.test(input.value[caret])) digits++;
            caret++;
        }
        input.setSelectionRange(caret, caret);
    }
}
