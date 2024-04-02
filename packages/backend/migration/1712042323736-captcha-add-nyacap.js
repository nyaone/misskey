/*
 * SPDX-FileCopyrightText: Nya Candy and NyaOne
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class CaptchaAddNyacap1712042323736 {
    name = 'CaptchaAddNyacap1712042323736'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" ADD "enableNyaCap" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "meta" ADD "nyacapSiteKey" character varying(1024)`);
        await queryRunner.query(`ALTER TABLE "meta" ADD "nyacapSecretKey" character varying(1024)`);
        await queryRunner.query(`ALTER TABLE "meta" ADD "nyacapInstanceUrl" character varying(1024)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "nyacapInstanceUrl"`);
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "nyacapSecretKey"`);
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "nyacapSiteKey"`);
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "enableNyaCap"`);
    }
}
