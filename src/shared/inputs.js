// Input indicators, bottom right of every page (same pattern as
// axis-launcher-front's Inputs component): glyph + label, fade out 0.1 s /
// in 0.5 s when the set changes. Glyphs live in /icons/input-<key>.svg.

const SWITCH_OUT_MS = 100;

export function createInputs(container) {
    let currentKey = '';
    let switchTimeout = null;

    function build(input) {
        const indicator = document.createElement('div');
        indicator.className = 'input-indicator';

        const icon = document.createElement('img');
        icon.className = 'input-icon';
        icon.src = `/icons/input-${input.key}.svg`;
        icon.alt = '';
        indicator.appendChild(icon);

        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = input.label;
        indicator.appendChild(label);

        return indicator;
    }

    return function setInputs(inputs) {
        const key = JSON.stringify(inputs);
        if (key === currentKey) return;
        currentKey = key;

        const apply = () => {
            container.innerHTML = '';
            inputs.forEach((input) => container.appendChild(build(input)));
            container.classList.remove('is-switching');
        };

        clearTimeout(switchTimeout);

        if (!container.children.length) return apply();

        container.classList.add('is-switching');
        switchTimeout = setTimeout(apply, SWITCH_OUT_MS);
    };
}
