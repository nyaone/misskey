/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as assert from 'assert';
import { Test } from '@nestjs/testing';

import { CoreModule } from '@/core/CoreModule.js';
import { ReactionService } from '@/core/ReactionService.js';
import { GlobalModule } from '@/GlobalModule.js';

describe('ReactionService', () => {
	let reactionService: ReactionService;

	beforeAll(async () => {
		const app = await Test.createTestingModule({
			imports: [GlobalModule, CoreModule],
		}).compile();
		reactionService = app.get<ReactionService>(ReactionService);
	});

	describe('normalize', () => {
		test('絵文字リアクションはそのまま', async () => {
			assert.strictEqual(await reactionService.normalize('👍'), '👍');
			assert.strictEqual(await reactionService.normalize('🍅'), '🍅');
		});

		test('既存のリアクションは絵文字化する pudding', async () => {
			assert.strictEqual(await reactionService.normalize('pudding'), '🍮');
		});

		test('既存のリアクションは絵文字化する like', async () => {
			assert.strictEqual(await reactionService.normalize('like'), '👍');
		});

		test('既存のリアクションは絵文字化する love', async () => {
			assert.strictEqual(await reactionService.normalize('love'), '❤');
		});

		test('既存のリアクションは絵文字化する laugh', async () => {
			assert.strictEqual(await reactionService.normalize('laugh'), '😆');
		});

		test('既存のリアクションは絵文字化する hmm', async () => {
			assert.strictEqual(await reactionService.normalize('hmm'), '🤔');
		});

		test('既存のリアクションは絵文字化する surprise', async () => {
			assert.strictEqual(await reactionService.normalize('surprise'), '😮');
		});

		test('既存のリアクションは絵文字化する congrats', async () => {
			assert.strictEqual(await reactionService.normalize('congrats'), '🎉');
		});

		test('既存のリアクションは絵文字化する angry', async () => {
			assert.strictEqual(await reactionService.normalize('angry'), '💢');
		});

		test('既存のリアクションは絵文字化する confused', async () => {
			assert.strictEqual(await reactionService.normalize('confused'), '😥');
		});

		test('既存のリアクションは絵文字化する rip', async () => {
			assert.strictEqual(await reactionService.normalize('rip'), '😇');
		});

		test('既存のリアクションは絵文字化する star', async () => {
			assert.strictEqual(await reactionService.normalize('star'), '⭐');
		});

		test('異体字セレクタ除去', async () => {
			assert.strictEqual(await reactionService.normalize('㊗️'), '㊗');
		});

		test('異体字セレクタ除去 必要なし', async () => {
			assert.strictEqual(await reactionService.normalize('㊗'), '㊗');
		});

		test('fallback - null', async () => {
			assert.strictEqual(await reactionService.normalize(null), '⭐');
		});

		test('fallback - empty', async () => {
			assert.strictEqual(await reactionService.normalize(''), '⭐');
		});

		test('fallback - unknown', async () => {
			assert.strictEqual(await reactionService.normalize('unknown'), '⭐');
		});
	});
});
