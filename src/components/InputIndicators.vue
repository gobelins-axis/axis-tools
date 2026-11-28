<script setup>
// Input indicators, bottom right of every page (same pattern as
// axis-launcher-front's Inputs component): glyph + label, fade out 0.1 s /
// in 0.5 s when the set changes. Glyphs live in /icons/input-<key>.svg.
//
//   <InputIndicators :inputs="[{ key: 'a', label: 'Open' }, { key: 'home', label: 'Exit' }]" />

import { ref, watch, onBeforeUnmount } from 'vue';

const SWITCH_OUT_MS = 100;

const props = defineProps({
    inputs: { type: Array, required: true },
});

const shown = ref([]);
const isSwitching = ref(false);
let switchTimeout = null;

watch(
    () => JSON.stringify(props.inputs),
    () => {
        const next = props.inputs.map((input) => ({ ...input }));
        clearTimeout(switchTimeout);

        if (!shown.value.length) {
            shown.value = next;
            return;
        }

        isSwitching.value = true;
        switchTimeout = setTimeout(() => {
            shown.value = next;
            isSwitching.value = false;
        }, SWITCH_OUT_MS);
    },
    { immediate: true },
);

onBeforeUnmount(() => clearTimeout(switchTimeout));
</script>

<template>
    <footer class="inputs">
        <div class="inputs-container" :class="{ 'is-switching': isSwitching }">
            <div v-for="input in shown" :key="input.key + input.label" class="input-indicator">
                <img class="input-icon" :src="`/icons/input-${input.key}.svg`" alt="">
                <span class="label">{{ input.label }}</span>
            </div>
        </div>
    </footer>
</template>
