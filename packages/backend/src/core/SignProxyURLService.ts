/*
 * SPDX-FileCopyrightText: Nya Candy and NyaOne
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from "@nestjs/common";
import { DI } from "@/di-symbols.js";
import type { Config } from "@/config.js";
import { createHmac, timingSafeEqual } from 'crypto';
import { bindThis } from "@/decorators.js";

@Injectable()
export class SignProxyURLService {
	constructor(
		@Inject(DI.config)
		private config: Config,
	) {
	}

	@bindThis
	public signProxyURL(unsignedURLString: string): string {
		if (this.config.mediaProxySignatureKey === null) {
			return unsignedURLString; // 未启用签名
		}

		// 格式化原始 URL (query)
		const workingURL = new URL(unsignedURLString);

		// 设定过期时间
		const exp = Math.floor(Date.now() / 1000) + 900; // 15 分钟
		workingURL.searchParams.set('exp', exp.toString());

		// 检查是否有 static 参数：因为前端可能会追加这个参数，为避免参数影响，要把它删除掉。
		const possibleStaticParam = workingURL.searchParams.get('static');
		if (possibleStaticParam !== null) {
			workingURL.searchParams.delete('static');
		}

		// 排序，以确保结果唯一性
		workingURL.searchParams.sort();

		// 拼接待签名的完整 URL
		const toSignURL = workingURL.toString();

		// 生成签名
		const sig = createHmac('sha256', this.config.mediaProxySignatureKey).
			update(toSignURL).digest('hex');

		// 追加到 URL
		workingURL.searchParams.set('sig', sig.toString());

		// 追加在上一步中可能被删除的 static 参数
		if (possibleStaticParam !== null) {
			workingURL.searchParams.set('static', possibleStaticParam);
		}

		// 返回格式化
		return workingURL.toString();
	}

	@bindThis
	public verifySignedProxyURL(signedURLString: string): boolean {
		if (this.config.mediaProxySignatureKey === null) {
			return true; // 未启用签名，则直接认为是有效的
		}

		const workingURL = new URL(signedURLString);

		// 提取签名参数
		const sig = workingURL.searchParams.get('sig');
		if (sig === null) {
			// 缺失签名
			return false;
		}

		// 去掉签名参数
		workingURL.searchParams.delete('sig');

		// 提取过期时间
		const exp = workingURL.searchParams.get('exp');
		if (exp === null) {
			// 缺失过期时间
			return false;
		}
		// 检查是否已过期
		const expEpochSec = parseInt(exp);
		if (expEpochSec > Date.now() / 1000) {
			// 无效的时间，或者已经超时
			return false;
		}

		// 检查是否有 static 参数：因为前端可能会追加这个参数，为避免参数影响，要把它删除掉。
		if (workingURL.searchParams.has('static')) {
			workingURL.searchParams.delete('static');
		}

		// 排序查询字符串
		workingURL.searchParams.sort();

		// 生成正确的签名用来对照
		const sigCorrect = createHmac('sha256', this.config.mediaProxySignatureKey).
		update(workingURL.toString()).digest('hex');

		// 检查签名是否匹配
		if (!timingSafeEqual(Buffer.from(sigCorrect), Buffer.from(sig))) {
			// 不匹配
			return false;
		}

		// 验证通过
		return true;
	}
}
