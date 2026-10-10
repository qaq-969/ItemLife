ALTER TABLE `site_invites`
  DROP FOREIGN KEY `site_invites_created_by_fkey`;
ALTER TABLE `site_invites`
  MODIFY `created_by` BINARY(16) NULL;
ALTER TABLE `site_invites`
  ADD CONSTRAINT `site_invites_created_by_fkey`
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `transactions`
  DROP FOREIGN KEY `transactions_created_by_fkey`;
ALTER TABLE `transactions`
  MODIFY `created_by` BINARY(16) NULL;
ALTER TABLE `transactions`
  ADD CONSTRAINT `transactions_created_by_fkey`
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `inventory_reverts`
  DROP FOREIGN KEY `inventory_reverts_created_by_fkey`;
ALTER TABLE `inventory_reverts`
  MODIFY `created_by` BINARY(16) NULL;
ALTER TABLE `inventory_reverts`
  ADD CONSTRAINT `inventory_reverts_created_by_fkey`
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
