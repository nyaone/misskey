<!--
SPDX-FileCopyrightText: Nya Candy and NyaOne
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps_m">
	<div>
		<MkTextarea v-model="trustedExternalWebsites">
			<span>信任的域名</span>
			<template #caption>一行一个域名</template>
		</MkTextarea>
	</div>
	<MkButton primary inline :disabled="!changed" @click="save()"><i class="ti ti-device-floppy"></i> {{ i18n.ts.save }}</MkButton>
</div>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';

const props = defineProps<{
	trusted: string[];
}>();

const emit = defineEmits<{
	(ev: 'save', value: string[]): void;
}>();

const render = (trustedExternalWebsites) => trustedExternalWebsites.join('\n');

const trustedExternalWebsites = ref(render(props.trusted));
const changed = ref(false);

watch(trustedExternalWebsites, () => {
	changed.value = true;
});

async function save() {
	const parseTrusted = (trusted) => {
		// split into lines, remove empty lines and unnecessary whitespace
		let lines = trusted.trim().split('\n').map(line => line.trim()).filter(line => line !== '');

		// // check each line if it is a RegExp or not
		// for (let i = 0; i < lines.length; i++) {
		// 	const line = lines[i];
		// 	const regexp = line.match(/^\/(.+)\/(.*)$/);
		// 	if (regexp) {
		// 		// check that the RegExp is valid
		// 		try {
		// 			new RegExp(regexp[1], regexp[2]);
		// 			// note that regex lines will not be split by spaces!
		// 		} catch (err: any) {
		// 			// invalid syntax: do not save, do not reset changed flag
		// 			os.alert({
		// 				type: 'error',
		// 				title: i18n.ts.regexpError,
		// 				text: i18n.tsx.regexpErrorDescription({ tab: 'website trust', line: i + 1 }) + '\n' + err.toString(),
		// 			});
		// 			// re-throw error so these invalid settings are not saved
		// 			throw err;
		// 		}
		// 	}
		// }

		return lines;
	};

	let parsed;
	try {
		parsed = parseTrusted(trustedExternalWebsites.value);
	} catch (err) {
		// already displayed error message in parse
		return;
	}

	emit('save', parsed);

	changed.value = false;
}
</script>
