export const $ = (id) => document.getElementById(id);

export function setText(id, value) {
    $(id).textContent = value;
}
