<script setup lang="ts">
import { ref, watch } from "vue";

const { features } = defineProps<{
  features: any[];
}>();

const selected = ref<any>(null);

const emit = defineEmits<{
  selectFeature: [feature: any];
}>();

function selectFeature(e, feature: any) {
  selected.value = e.target.open ? feature : null;
}

watch(selected, (feature) => emit("selectFeature", feature));
watch(
  () => features,
  () => {
    selected.value = null;
  },
);
</script>

<template>
  <div
    class="inspector divide-y divide-gray-300 border-r border-r-slate-400 shadow-2xl w-80"
  >
    <svg xmlns="http://www.w3.org/2000/svg" class="hidden">
      <symbol id="icon-polygon" viewBox="0 0 24 24">
        <path
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0m7 3a2 2 0 1 0 4 0a2 2 0 1 0-4 0M3 11a2 2 0 1 0 4 0a2 2 0 1 0-4 0m10 8a2 2 0 1 0 4 0a2 2 0 1 0-4 0M6.5 9.5l3.5-3m4-1L17 7m1.5 3L16 17m-2.5.5l-7-5"
        />
      </symbol>
      <symbol id="icon-point" viewBox="0 0 24 24">
        <path
          fill="currentColor"
          d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7m0 9.5a2.5 2.5 0 0 1 0-5a2.5 2.5 0 0 1 0 5"
        />
      </symbol>
      <symbol id="icon-line" viewBox="0 0 24 24">
        <path
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.5"
          d="M8.121 15.879a3 3 0 1 0-4.243 4.243a3 3 0 0 0 4.243-4.243m0 0L15.88 8.12m0 0a3 3 0 1 0 4.243-4.243A3 3 0 0 0 15.88 8.12m0 0l.004-.004"
        />
      </symbol>
    </svg>
    <details
      :open="selected == feature"
      v-for="(feature, index) in features"
      :key="index"
      :class="{
        'details-content:px-6': true,
        'bg-slate-300/50': feature === selected,
      }"
      @toggle="selectFeature($event, feature)"
    >
      <summary
        class="flex flex-row items-center gap-2 cursor-pointer transition-colors duration-1000 hover:bg-slate-200/50 p-4"
      >
        <svg
          v-if="['Polygon', 'MultiPolygon'].includes(feature.geometry.type)"
          class="icon"
          width="16"
          height="16"
        >
          <use href="#icon-polygon" />
        </svg>
        <svg
          v-else-if="['Point', 'MultiPoint'].includes(feature.geometry.type)"
          class="icon"
          width="16"
          height="16"
        >
          <use href="#icon-point" />
        </svg>
        <svg v-else class="icon" width="16" height="16">
          <use href="#icon-line" />
        </svg>
        <strong>{{ feature.sourceLayer }}</strong>
      </summary>
      <h3
        class="text-xs font-semibold uppercase tracking-wide mb-1 text-slate-500"
      >
        Properties
      </h3>
      <dl>
        <template v-for="(value, key) in feature.properties" :key="key">
          <dt>{{ key }}</dt>
          <dd>{{ value }}</dd>
        </template>
      </dl>

      <!-- <ul>
        <li v-for="(value, key) in feature.properties" :key="key">
          {{ key }}: {{ value }}
        </li>
      </ul> -->
      <details v-for="(value, key) in feature" :key="key">
        <summary>{{ key }}</summary>
        <pre>{{ JSON.stringify(value, null, 2) }}</pre>
      </details>
    </details>
  </div>
</template>

<style scoped>
.inspector {
  /*
  position: absolute;
  top: 1rem;
  left: 1rem;
  bottom: 1rem;
  background: rgba(255, 255, 255, 0.9);
  border-left: 1px solid #ccc;
  border-radius: 0.5rem;
  box-shadow: 0 2px 0.5rem rgba(0, 0, 0, 0.25);
  */
  /* width: 25rem; */
  overflow: auto;
}

dl {
  display: grid;
  /* grid-template-rows: 1rem auto; */
  grid-template-columns: auto auto;
  gap: 0.25rem 0;
}

dt {
  font-size: 0.8rem;
  color: rgba(0, 0, 0, 0.6);
}
</style>
