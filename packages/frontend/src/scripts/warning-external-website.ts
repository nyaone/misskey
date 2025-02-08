// Modified from https://github.com/MisskeyIO/misskey/blob/io/packages/frontend/src/scripts/warning-external-website.ts

// import { url as local } from '@/config.js';
import { defaultStore } from '@/store.js';
// import { instance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';

const extractDomain = /^(https?:\/\/|\/\/)?([^@/\s]+@)?(www\.)?([^:/\s]+)/i;
// const isRegExp = /^\/(.+)\/(.*)$/;

export async function warningExternalWebsite(ev: MouseEvent, url: string) {
	const local = window.location.host;

	const domain = extractDomain.exec(url)?.[4];
	const self = !domain || url.startsWith(local);
	// const isWellKnownWebsite = self || instance.wellKnownWebsites.some(expression => {
	// 	const r = isRegExp.exec(expression);
	// 	if (r) {
	// 		return new RegExp(r[1], r[2]).test(url);
	// 	} else if (expression.includes(' ')) return expression.split(' ').every(keyword => url.includes(keyword));
	// 	else return domain.endsWith(expression);
	// });
	// const isTrusted = defaultStore.reactiveState.trustedExternalWebsites.value.includes(domain);

	// if (!self && !isWellKnownWebsite && !isTrusted) {
	if (!self) {
		ev.preventDefault();
		ev.stopPropagation();

		const confirm = await os.actions({
			type: 'warning',
			title: '跳转到外部网站',
			text: '您即将离开本站，跳转到其他网站。\n在继续之前，请务必仔细检查链接是否安全。\n\n' + `\`\`\`\n${url}\n\`\`\``,
			actions: [
				{
					value: 'yes' as const,
					text: '确认前往',
					primary: true,
				},
				{
					value: 'trust' as const,
					text: '信任并前往',
					danger: true,
				},
				{
					value: 'no' as const,
					text: i18n.ts.cancel,
				},
			],
		});
		if (confirm.canceled) return false;
		if (confirm.result === 'no') return false;

		if (confirm.result === 'trust') {
			await defaultStore.set('trustedExternalWebsites', [...defaultStore.reactiveState.trustedExternalWebsites.value, domain]);
		}

		window.open(url, '_blank', 'noopener');
	}

	return true;
}
