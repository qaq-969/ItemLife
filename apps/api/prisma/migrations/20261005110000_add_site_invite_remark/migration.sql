ALTER TABLE `site_invites`
  ADD COLUMN `remark` VARCHAR(100) NULL,
  ADD COLUMN `used_by` BINARY(16) NULL;

CREATE UNIQUE INDEX `site_invites_used_by_key` ON `site_invites`(`used_by`);

ALTER TABLE `site_invites`
  ADD CONSTRAINT `site_invites_used_by_fkey`
  FOREIGN KEY (`used_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
