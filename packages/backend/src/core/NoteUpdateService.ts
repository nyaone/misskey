/*
 * SPDX-FileCopyrightText: Nya Candy and NyaOne
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { setImmediate } from 'node:timers/promises';
import { Injectable, Inject } from '@nestjs/common';
import * as mfm from 'mfm-js';
import { In, DataSource, IsNull, LessThan } from 'typeorm';
import type { MiUser, MiLocalUser, MiRemoteUser } from '@/models/User.js';
import { MiNote } from '@/models/Note.js';
import type {
	InstancesRepository,
	MiDriveFile,
	NotesRepository,
	UserProfilesRepository,
	UsersRepository,
} from '@/models/_.js';
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
import { extractHashtags } from '@/misc/extract-hashtags.js';
import type { IMentionedRemoteUsers } from '@/models/Note.js';
import { extractCustomEmojisFromMfm } from '@/misc/extract-custom-emojis-from-mfm.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { RoleService } from '@/core/RoleService.js';
import { normalizeForSearch } from '@/misc/normalize-for-search.js';
import { HashtagService } from '@/core/HashtagService.js';

type MinimumUser = {
	id: MiUser['id'];
	host: MiUser['host'];
	username: MiUser['username'];
	uri: MiUser['uri'];
};

type Option = {
	updatedAt?: Date | null;
	text?: string | null;
	files?: MiDriveFile[] | null;
	// poll?: IPoll | null;
	cw?: string | null;
	// visibility?: string;
	// visibleUsers?: MinimumUser[] | null;
	apEmojis?: string[] | null;
	apMentions?: MinimumUser[] | null;
	apHashtags?: string[] | null;
}

@Injectable()
export class NoteUpdateService {
	#shutdownController = new AbortController();

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.instancesRepository)
		private instancesRepository: InstancesRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private userEntityService: UserEntityService,
		private noteEntityService: NoteEntityService,
		private globalEventService: GlobalEventService,
		private relayService: RelayService,
		private federatedInstanceService: FederatedInstanceService,
		private hashtagService: HashtagService,
		private remoteUserResolveService: RemoteUserResolveService,
		private apDeliverManagerService: ApDeliverManagerService,
		private apRendererService: ApRendererService,
		private roleService: RoleService,
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
	 * @param data New note info
	 * @param silent Skip broadcast to frontend message stream
	 * @param updater Who update this note (by user or admin)
	 */
	async update(user: { id: MiUser['id']; uri: MiUser['uri']; host: MiUser['host']; isBot: MiUser['isBot']; }, note: MiNote, data: Option, silent = false, updater?: MiUser) {
		if (!data.updatedAt) {
			throw new Error('update time is required');
		}

		if (note.history && note.history.findIndex(h => h.createdAt === data.updatedAt?.toISOString()) !== -1) {
			// Same history already exists, skip this
			return;
		}

		// Check if is latest or previous version
		const history = [...(note.history || []), {
			createdAt: (note.updatedAt || this.idService.parse(note.id).date).toISOString(),
			cw: note.cw,
			text: note.text,
		}];
		if (note.updatedAt && note.updatedAt >= data.updatedAt) {
			// Previous version, just update history
			history.sort((h1, h2) => new Date(h1.createdAt).getTime() - new Date(h2.createdAt).getTime()); // earliest -> latest

			await this.notesRepository.update({ id: note.id }, {
				history,
			});
		} else {
			// Latest version

			let tags = data.apHashtags;
			let emojis = data.apEmojis;
			let mentionedUsers = data.apMentions;

			// Parse MFM if needed
			if (!tags || !emojis || !mentionedUsers) {
				const tokens = (data.text ? mfm.parse(data.text)! : []);
				const cwTokens = data.cw ? mfm.parse(data.cw)! : [];
				// const choiceTokens = ps.poll && ps.poll.choices
				// 	? concat(ps.poll.choices.map(choice => mfm.parse(choice)!))
				// 	: [];

				const combinedTokens = tokens.concat(cwTokens)/*.concat(choiceTokens)*/;

				tags = data.apHashtags ?? extractHashtags(combinedTokens);

				emojis = data.apEmojis ?? extractCustomEmojisFromMfm(combinedTokens);

				mentionedUsers = data.apMentions ?? await this.extractMentionedUsers(user, combinedTokens);
			}

			tags = tags.filter(tag => Array.from(tag).length <= 128).splice(0, 32);

			if (note.reply && (user.id !== note.reply.userId) && !mentionedUsers.some(u => u.id === note.reply!.userId)) {
				mentionedUsers.push(await this.usersRepository.findOneByOrFail({ id: note.reply!.userId }));
			}

			if (note.visibility === 'specified') {
				for (const uid of note.visibleUserIds) {
					if (!mentionedUsers.some(x => x.id === uid)) {
						mentionedUsers.push(await this.usersRepository.findOneByOrFail({ id: uid }));
					}
				}

				// if (note.reply && !note.visibleUserIds.some(uid => uid === note.reply!.userId)) {
				// 	visibleUsers.push(await this.usersRepository.findOneByOrFail({ id: note.reply!.userId }));
				// }
			}

			if (mentionedUsers.length > 0 && mentionedUsers.length > (await this.roleService.getUserPolicies(user.id)).mentionLimit) {
				throw new IdentifiableError('9f466dab-c856-48cd-9e65-ff90ff750580', 'Note contains too many mentions');
			}

			const newNote = await this.updateNote(user, note, data, tags, emojis, history, mentionedUsers);

			setImmediate('post updated', { signal: this.#shutdownController.signal }).then(
				() => this.postNoteUpdated(newNote, user, data, silent, tags!, mentionedUsers!),
				() => { /* aborted, ignore this */ },
			);
		}
	}

	@bindThis
	private async updateNote(user: { id: MiUser['id']; host: MiUser['host']; }, note: MiNote, data: Option, tags: string[], emojis: string[], history: MiNote['history'], mentionedUsers: MinimumUser[]) {
		const update = new MiNote({
			updatedAt: data.updatedAt,
			fileIds: data.files ? data.files.map(file => file.id) : [],
			history,
			cw: data.cw,
			text: data.text,
			tags: tags.map(tag => normalizeForSearch(tag)),
			emojis,

			attachedFileTypes: data.files ? data.files.map(file => file.type) : [],
		});

		// Append mentions data
		if (mentionedUsers.length > 0) {
			update.mentions = mentionedUsers.map(u => u.id);
			const profiles = await this.userProfilesRepository.findBy({ userId: In(update.mentions) });
			update.mentionedRemoteUsers = JSON.stringify(mentionedUsers.filter(u => this.userEntityService.isRemoteUser(u)).map(u => {
				const profile = profiles.find(p => p.userId === u.id);
				const url = profile != null ? profile.url : null;
				return {
					uri: u.uri,
					url: url ?? undefined,
					username: u.username,
					host: u.host,
				} as IMentionedRemoteUsers[0];
			}));
		}

		// Update note
		await this.notesRepository.update({ id: note.id }, update);

		return update;
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
	private async postNoteUpdated(note: MiNote, user: {
		id: MiUser['id'];
		// username: MiUser['username'];
		host: MiUser['host'];
		isBot: MiUser['isBot'];
	}, data: Option, silent: boolean, tags: string[], mentionedUsers: MinimumUser[]) {
		// ハッシュタグ更新
		if (note.visibility === 'public' || note.visibility === 'home') {
			this.hashtagService.updateHashtags(user, tags);
		}

		if (!silent) {
			this.globalEventService.publishNoteStream(note.id, 'updated', {
				cw: note.cw ?? null,
				text: note.text ?? '',
				updatedAt: note.updatedAt!.toISOString(),
			});

			//#region AP deliver
			if (this.userEntityService.isLocalUser(user) && !note.localOnly) {
				const content = this.apRendererService.addContext(
					this.apRendererService.renderUpdateNote(
						await this.apRendererService.renderNote(note, false), note,
					),
				);

				this.deliverToConcerned(user, note, content);
			}
			//#endregion
		}

		// Register to search database
		this.index(note);

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

	@bindThis
	private index(note: MiNote) {
		if (note.text == null && note.cw == null) return;

		this.searchService.indexNote(note);
	}
}
