/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Misskey from 'misskey-js';
import { DI } from '@/di-symbols.js';
import type { SigninsRepository, UserProfilesRepository } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import type { MiLocalUser } from '@/models/User.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { SigninEntityService } from '@/core/entities/SigninEntityService.js';
import { bindThis } from '@/decorators.js';
import { EmailService } from '@/core/EmailService.js';
import { NotificationService } from '@/core/NotificationService.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class SigninService {
	constructor(
		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private signinEntityService: SigninEntityService,
		private emailService: EmailService,
		private notificationService: NotificationService,
		private idService: IdService,
		private globalEventService: GlobalEventService,
	) {
	}

	@bindThis
	public signin(request: FastifyRequest, reply: FastifyReply, user: MiLocalUser) {
		setImmediate(async () => {
			this.notificationService.createNotification(user.id, 'login', {});

			const record = await this.signinsRepository.insertOne({
				id: this.idService.gen(),
				userId: user.id,
				ip: request.ip,
				headers: request.headers as any,
				success: true,
			});

			this.globalEventService.publishMainStream(user.id, 'signin', await this.signinEntityService.pack(record));

			const messageHTML = '<p>您的账号出现了一次新的登录。如果您无法识别此次登录，请立刻更新您的账号安全信息，包括修改密码。</p>';

			const additionalInfo = [];
			if (request.ip) {
				additionalInfo.push(`登录IP地址: ${request.ip}`);
			}
			if (request.headers['user-agent']) {
				additionalInfo.push(`使用的设备: ${request.headers['user-agent']}`);
			}

			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: user.id });
			if (profile.email && profile.emailVerified) {
				this.emailService.sendEmail(profile.email, '新的登录',
					messageHTML + additionalInfo.length ? (`<hr><p>登录详细信息：</p><ul>` + additionalInfo.map(info => `<li>${info}</li>`).join('') + '</ul>') : '',
					'您的账号出现了一次新的登录。如果您无法识别此次登录，请立刻更新您的账号安全信息，包括修改密码。');
			}
		});

		reply.code(200);
		return {
			finished: true,
			id: user.id,
			i: user.token!,
		} satisfies Misskey.entities.SigninFlowResponse;
	}
}

