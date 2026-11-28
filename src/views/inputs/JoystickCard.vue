<script setup>
// One joystick of the input debugger. The model (created in InputsView) holds
// the samples and the canvases; InputsView's frame loop draws into them
// (draw.js) and fills model.readout, which this template shows.

import { ref, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps({
    model: { type: Object, required: true },
});

const canvas = ref(null);
const chart = ref(null);

onMounted(() => {
    props.model.canvas = canvas.value;
    props.model.chart = chart.value;
});

onBeforeUnmount(() => {
    props.model.canvas = null;
    props.model.chart = null;
});

function resetRange() {
    props.model.range = null;
}

function recenter() {
    if (props.model.raw) props.model.rest = { ...props.model.raw };
}
</script>

<template>
    <section class="card joystick">
        <h2>Joystick {{ model.id }} <span class="rate">{{ model.readout.rate }}</span></h2>

        <div class="joystick-body">
            <canvas ref="canvas" class="js-canvas" width="150" height="150"></canvas>

            <div class="readouts">
                <h3>Normalized (what your game gets)</h3>
                <table>
                    <tr><th>x</th><td>{{ model.readout.nx }}</td></tr>
                    <tr><th>y</th><td>{{ model.readout.ny }}</td></tr>
                    <tr><th>magnitude</th><td>{{ model.readout.nmag }}</td></tr>
                    <tr><th>angle</th><td>{{ model.readout.nangle }}</td></tr>
                </table>

                <h3>Raw ADC (machine only)</h3>
                <table>
                    <tr><th>x</th><td>{{ model.readout.rx }}</td></tr>
                    <tr><th>y</th><td>{{ model.readout.ry }}</td></tr>
                    <tr><th>rest</th><td>{{ model.readout.rest }}</td></tr>
                    <tr><th>min / max x</th><td>{{ model.readout.rminmaxx }}</td></tr>
                    <tr><th>min / max y</th><td>{{ model.readout.rminmaxy }}</td></tr>
                </table>
                <p class="hint">API calibration: x 18–840, y 36–867. Values outside clip at ±1.</p>
                <div class="actions">
                    <button @click="resetRange">Reset min/max</button>
                    <button @click="recenter">Set rest</button>
                </div>
            </div>
        </div>

        <div class="quickmove">
            <span class="qm" :class="{ active: model.readout.qmActive.left }">◀ left <b>{{ model.readout.qm.left }}</b></span>
            <span class="qm" :class="{ active: model.readout.qmActive.up }">▲ up <b>{{ model.readout.qm.up }}</b></span>
            <span class="qm" :class="{ active: model.readout.qmActive.down }">▼ down <b>{{ model.readout.qm.down }}</b></span>
            <span class="qm" :class="{ active: model.readout.qmActive.right }">▶ right <b>{{ model.readout.qm.right }}</b></span>
        </div>

        <canvas ref="chart" class="chart" width="460" height="60"></canvas>
        <p class="hint">Chart: <span class="swatch x"></span>x <span class="swatch y"></span>y over the last ~5s. Dashed lines = API calibration bounds.</p>
    </section>
</template>
