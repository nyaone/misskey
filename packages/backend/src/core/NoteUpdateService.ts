/*
 * SPDX-FileCopyrightText: syuilo and other misskey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Brackets, In } from 'typeorm';
import { Injectable, Inject } from '@nestjs/common';
import * as mfm from 'mfm-js';
import type { MiUser, MiLocalUser, MiRemoteUser } from '@/models/User.js';
import type { MiNote, IMentionedRemoteUsers } from '@/models/Note.js';
import type { InstancesRepository, NotesRepository, UsersRepository } from '@/models/_.js';
import { RelayService } from '@/core/RelayService.js';
import { FederatedInstanceService } from '@/core/FederatedInstanceService.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import NotesChart from '@/core/chart/charts/notes.js';
import PerUserNotesChart from '@/core/chart/charts/per-user-notes.js';
import InstanceChart from '@/core/chart/charts/instance.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { ApRendererService } from '@/core/activitypub/ApRendererService.js';
import { ApDeliverManagerService } from '@/core/activitypub/ApDeliverManagerService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { bindThis } from '@/decorators.js';
import { MetaService } from '@/core/MetaService.js';
import { SearchService } from '@/core/SearchService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { IdService } from '@/core/IdService.js';
import { trackPromise } from '@/misc/promise-tracker.js';
import { extractMentions } from '@/misc/extract-mentions.js';
import { RemoteUserResolveService } from '@/core/RemoteUserResolveService.js';

@Injectable()
export class NoteUpdateService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.instancesRepository)
		private instancesRepository: InstancesRepository,

		private userEntityService: UserEntityService,
		private noteEntityService: NoteEntityService,
		private globalEventService: GlobalEventService,
		private relayService: RelayService,
		private federatedInstanceService: FederatedInstanceService,
		private remoteUserResolveService: RemoteUserResolveService,
		private apRendererService: ApRendererService,
		private apDeliverManagerService: ApDeliverManagerService,
		private metaService: MetaService,
		private searchService: SearchService,
		private moderationLogService: ModerationLogService,
		private notesChart: NotesChart,
		private perUserNotesChart: PerUserNotesChart,
		private instanceChart: InstanceChart,
		private idService: IdService,
	) {}

	/**
	 * Update note
	 * @param user Note creator
	 * @param note Note to update
	 * @param ps New note info
	 */
	async update(user: { id: MiUser['id']; uri: MiUser['uri']; host: MiUser['host']; isBot: MiUser['isBot']; }, note: MiNote, ps: Pick<MiNote, 'text' | 'cw'>, quiet = false, updater?: MiUser) {
		const newNote = {
			...note,
			...ps, // Overwrite updated fields
		};

		if (!quiet) {
			this.globalEventService.publishNoteStream(note.id, 'updated', {
				cw: ps.cw,
				text: ps.text ?? '', // prevent null
			});

			if (this.userEntityService.isLocalUser(user) && !note.localOnly) {
				const content = this.apRendererService.addContext(
					this.apRendererService.renderUpdateNote(
						await this.apRendererService.renderNote(newNote, false), newNote,
					),
				);

				this.deliverToConcerned(user, newNote, content);
			}
		}

		this.searchService.indexNote(newNote);

		await this.notesRepository.update({ id: note.id }, {
			updatedAt: new Date(),
			history: [...(note.history || []), {
				createdAt: (note.updatedAt || this.idService.parse(note.id).date).toISOString(),
				cw: note.cw,
				text: note.text,
			}],
			cw: ps.cw,
			text: ps.text,
		});

		// Currently not implemented
		// if (updater && (note.userId !== updater.id)) {
		// 	const user = await this.usersRepository.findOneByOrFail({ id: note.userId });
		// 	this.moderationLogService.log(updater, 'updateNote', {
		// 		noteId: note.id,
		// 		noteUserId: note.userId,
		// 		noteUserUsername: user.username,
		// 		noteUserHost: user.host,
		// 		note: note,
		// 	});
		// }
	}

	@bindThis
	private async extractMentionedUsers(user: { host: MiUser['host']; }, tokens: mfm.MfmNode[]): Promise<MiUser[]> {
		if (tokens == null) return [];

		const mentions = extractMentions(tokens);
		let mentionedUsers = (await Promise.all(mentions.map(m =>
			this.remoteUserResolveService.resolveUser(m.username, m.host ?? user.host).catch(() => null),
		))).filter(x => x != null) as MiUser[];

		// Drop duplicate users
		mentionedUsers = mentionedUsers.filter((u, i, self) =>
			i === self.findIndex(u2 => u.id === u2.id),
		);

		return mentionedUsers;
	}

	@bindThis
	private async deliverToConcerned(user: { id: MiLocalUser['id']; host: null; }, note: MiNote, noteActivity: any) {
		const dm = this.apDeliverManagerService.createDeliverManager(user, noteActivity);

		// Parse MFM if needed
		const tokens = (note.text ? mfm.parse(note.text)! : []);
		const cwTokens = note.cw ? mfm.parse(note.cw)! : [];

		const combinedTokens = tokens.concat(cwTokens);

		const mentionedUsers = await this.extractMentionedUsers(user, combinedTokens);

		if (note.reply && (user.id !== note.reply.userId) && !mentionedUsers.some(u => u.id === note.reply!.userId)) {
			mentionedUsers.push(await this.usersRepository.findOneByOrFail({ id: note.reply.userId }));
		}

		if (note.visibility === 'specified') {
			if (note.visibleUserIds == null) throw new Error('invalid param');

			for (const u of note.visibleUserIds) {
				if (!mentionedUsers.some(x => x.id === u)) {
					mentionedUsers.push(await this.usersRepository.findOneByOrFail({ id: u }));
				}
			}
		}

		// メンションされたリモートユーザーに配送
		for (const u of mentionedUsers.filter(u => this.userEntityService.isRemoteUser(u))) {
			dm.addDirectRecipe(u as MiRemoteUser);
		}

		// 投稿がリプライかつ投稿者がローカルユーザーかつリプライ先の投稿の投稿者がリモートユーザーなら配送
		if (note.reply && note.reply.userHost !== null) {
			const u = await this.usersRepository.findOneBy({ id: note.reply.userId });
			if (u && this.userEntityService.isRemoteUser(u)) dm.addDirectRecipe(u);
		}

		// 投稿がRenoteかつ投稿者がローカルユーザーかつRenote元の投稿の投稿者がリモートユーザーなら配送
		if (note.renote && note.renote.userHost !== null) {
			const u = await this.usersRepository.findOneBy({ id: note.renote.userId });
			if (u && this.userEntityService.isRemoteUser(u)) dm.addDirectRecipe(u);
		}

		// フォロワーに配送
		if (['public', 'home', 'followers'].includes(note.visibility)) {
			dm.addFollowersRecipe();
		}

		if (['public'].includes(note.visibility)) {
			this.relayService.deliverToRelays(user, noteActivity);
		}

		trackPromise(dm.execute());
	}
}
